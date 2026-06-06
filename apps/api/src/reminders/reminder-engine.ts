/**
 * 提醒與通知引擎核心（純領域邏輯，無 DB / Nest 相依）。
 *
 * 對應需求規格 §8.3「系統於各計畫時間點主動提醒作業人員應完成事項」與 issue #22（4.2）：
 * - 各步驟到期 / 待辦提醒；可提前（lead）、到期當日（due）、逾期（overdue）多時點提醒。
 * - 提醒時間點依行事曆（含遞延）計算 → 本引擎之 fireDate 由「已套用行事曆遞延的到期日
 *   (dueDate)」推導，故當 4.1 calendar-engine 重算 dueDate（連假遞延）時，提醒時間自動同步
 *   調整（滿足驗收：遞延後提醒時間同步調整）。
 * - 通知管道（系統內 / Email / 其他，§12-7 待釐清）：以 ReminderChannel 列舉 + 可插拔
 *   ReminderDispatcher 介面抽象化；引擎只決定「誰、何時、走哪些管道、提醒什麼」，不綁定任一
 *   外部送信實作（沿用 4.1 對 DeferralMode「兩種規則皆實作、不臆測」的保留介面風格）。
 *
 * 設計沿用 workflow / forms / templates / onboarding / environment / customization / calendar
 * 引擎之「純引擎 + Service」風格：本檔可被純函式單元測試完整覆蓋；ReminderService 再以 Prisma
 * 取負責人 / 步驟到期日、append-only 落地派送日誌與去重。
 *
 * 日界沿用 calendar-engine 之 UTC 慣例（toIsoDate 等）。
 */

import {
  HolidayCalendar,
  addDays,
  calendarDaysBetween,
  deferToWorkday,
  previousWorkday,
  toIsoDate,
} from '../calendar/calendar-engine';

/* ────────────────────────── 錯誤型別 ────────────────────────── */

export type ReminderEngineErrorCode =
  | 'target_invalid'
  | 'due_date_invalid'
  | 'recipient_required'
  | 'rule_offset_invalid'
  | 'occurrence_corrupt';

export class ReminderEngineError extends Error {
  constructor(
    public readonly code: ReminderEngineErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ReminderEngineError';
  }
}

/* ────────────────────────── 管道與提醒種類 ────────────────────────── */

/** 通知派送管道（§12-7 待釐清：三者皆以資料層表達，由可插拔 dispatcher 落地）。 */
export enum ReminderChannel {
  /** 系統內通知（站內信 / 待辦中心）。預設管道，無外部相依，本輪可直接落地。 */
  IN_APP = 'IN_APP',
  /** Email（需外部寄信服務；本輪保留 dispatcher 介面，未綁定實作）。 */
  EMAIL = 'EMAIL',
  /** 其他管道（如 Teams / SMS；保留擴充）。 */
  OTHER = 'OTHER',
}

/** 提醒種類（相對於到期日的時點語意）。 */
export enum ReminderKind {
  /** 提前提醒（到期前 N 天 / 工作日）。 */
  LEAD = 'LEAD',
  /** 到期當日提醒。 */
  DUE = 'DUE',
  /** 逾期提醒（到期後 N 天 / 工作日仍未完成）。 */
  OVERDUE = 'OVERDUE',
}

/* ────────────────────────── 提醒規則與政策 ────────────────────────── */

/** 單一提醒規則：相對到期日於何時、走哪些管道提醒。 */
export interface ReminderRule {
  kind: ReminderKind;
  /**
   * 相對到期日的偏移量（非負整數）。
   * - LEAD：到期「前」offsetDays；DUE：忽略（視為 0）；OVERDUE：到期「後」offsetDays。
   */
  offsetDays: number;
  /** offsetDays 是否以工作日計（需提供行事曆）；預設 false＝曆日。 */
  inWorkdays?: boolean;
  /** 此規則的派送管道；未指定則回退至 target.channels → policy.defaultChannels。 */
  channels?: readonly ReminderChannel[];
}

/** 提醒政策（部門 / 流程可自訂；此為內建預設）。 */
export interface ReminderPolicy {
  rules: readonly ReminderRule[];
  /** rule / target 皆未指定管道時的預設管道。 */
  defaultChannels: readonly ReminderChannel[];
  /** 是否將落在非工作日的提醒日遞延至工作日（需提供行事曆）。預設 true。 */
  deferFireToWorkday?: boolean;
}

/** 內建預設規則：到期前 3、1 個工作日提前提醒；到期當日；逾期 1 個工作日後再提醒。 */
export const DEFAULT_REMINDER_RULES: readonly ReminderRule[] = Object.freeze([
  Object.freeze({ kind: ReminderKind.LEAD, offsetDays: 3, inWorkdays: true }),
  Object.freeze({ kind: ReminderKind.LEAD, offsetDays: 1, inWorkdays: true }),
  Object.freeze({ kind: ReminderKind.DUE, offsetDays: 0 }),
  Object.freeze({ kind: ReminderKind.OVERDUE, offsetDays: 1, inWorkdays: true }),
]);

/** 內建預設政策（預設僅系統內通知，符合「本輪先落地 IN_APP」決策）。 */
export const DEFAULT_REMINDER_POLICY: ReminderPolicy = Object.freeze({
  rules: DEFAULT_REMINDER_RULES,
  defaultChannels: Object.freeze([ReminderChannel.IN_APP]),
  deferFireToWorkday: true,
});

/* ────────────────────────── 提醒對象 ────────────────────────── */

/**
 * 提醒對象：某案件 / 步驟之一個「到期時間點」與其負責人。
 * dueDate 應為「已套用行事曆遞延的計畫日」（如 onboarding ScheduledCheckpoint.plannedDate /
 * calendar reschedule 之 plannedDate）；本引擎不重算到期日，只據此推導提醒時點。
 */
export interface ReminderTarget {
  /** 穩定識別碼（如 `${caseId}:${step}`），作為去重與排序基準。 */
  key: string;
  /** 顯示用標題（如「啟動會議」）。 */
  label: string;
  /** 計畫到期日（已遞延）。 */
  dueDate: Date;
  /** 負責人 user id（提醒收件者）。 */
  recipientId: string;
  /** 此對象偏好的管道（覆寫 policy.defaultChannels，但低於 rule.channels）。 */
  channels?: readonly ReminderChannel[];
  /** 該時點應完成的表單代碼（供提醒內容引導）。 */
  formCodes?: readonly string[];
  /** 步驟識別（選填，便於前端 / 看板對應）。 */
  step?: string;
  /** 該時點是否已完成；完成則不產生提醒。 */
  completed?: boolean;
}

/* ────────────────────────── 提醒事件（occurrence） ────────────────────────── */

/**
 * 一筆「應於某日、走某管道、提醒某人」的提醒事件（時間無關，可預先全部展開）。
 * dedupKey 用於跨輪去重（避免同一時點同管道重複派送）。
 */
export interface ReminderOccurrence {
  /** 去重鍵：targetKey | recipientId | kind | offsetTag | channel | fireIsoDate。 */
  dedupKey: string;
  targetKey: string;
  label: string;
  step?: string;
  recipientId: string;
  channel: ReminderChannel;
  kind: ReminderKind;
  /** 計畫到期日（已遞延）。 */
  dueDate: Date;
  /** 應派送日（已套用工作日遞延）。 */
  fireDate: Date;
  formCodes: string[];
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function assertValidDate(d: unknown, code: ReminderEngineErrorCode): asserts d is Date {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) throw new ReminderEngineError(code);
}

/** 將日期往前 / 後移 n 個工作日（n>=0；往前傳 dir=-1）。需行事曆。 */
function shiftWorkdays(base: Date, n: number, dir: 1 | -1, cal: HolidayCalendar): Date {
  let cur = base;
  for (let i = 0; i < n; i += 1) {
    cur = dir > 0 ? deferToWorkday(addDays(cur, 1), cal) : previousWorkday(cur, cal);
  }
  return cur;
}

/** 計算單一規則相對 dueDate 的「原始提醒日」（尚未套用 fire 遞延）。 */
function ruleFireBase(dueDate: Date, rule: ReminderRule, cal?: HolidayCalendar): Date {
  if (!Number.isInteger(rule.offsetDays) || rule.offsetDays < 0) {
    throw new ReminderEngineError('rule_offset_invalid');
  }
  if (rule.kind === ReminderKind.DUE) return dueDate;
  const dir: 1 | -1 = rule.kind === ReminderKind.OVERDUE ? 1 : -1;
  if (rule.inWorkdays) {
    if (!cal) {
      // 無行事曆時退化為曆日，確保引擎在未提供曆法時仍可運作。
      return addDays(dueDate, dir * rule.offsetDays);
    }
    return shiftWorkdays(dueDate, rule.offsetDays, dir, cal);
  }
  return addDays(dueDate, dir * rule.offsetDays);
}

/** 穩定的偏移標籤（讓 dedupKey 對「提前3 vs 提前1」可區分）。 */
function offsetTag(rule: ReminderRule): string {
  const unit = rule.inWorkdays ? 'w' : 'c';
  return `${rule.kind}-${rule.offsetDays}${unit}`;
}

/**
 * 將提醒對象 + 政策展開為所有提醒事件（occurrence）。
 * - 跳過 completed 的對象。
 * - 每個 rule × 每個 channel 產生一筆 occurrence。
 * - LEAD 的提醒日若因遞延超過到期日，會夾擠回到期日（提前提醒不應晚於到期）。
 * - deferFireToWorkday 為真且提供行事曆時，提醒日遞延至工作日（避免落在假日）。
 * 回傳依 fireDate→kind→channel 穩定排序。
 */
export function computeReminderOccurrences(
  targets: readonly ReminderTarget[],
  policy: ReminderPolicy = DEFAULT_REMINDER_POLICY,
  cal?: HolidayCalendar,
): ReminderOccurrence[] {
  const out: ReminderOccurrence[] = [];
  const deferFire = policy.deferFireToWorkday !== false;
  for (const t of targets) {
    if (!t || typeof t !== 'object') throw new ReminderEngineError('target_invalid');
    if (!isNonEmptyString(t.key)) throw new ReminderEngineError('target_invalid');
    assertValidDate(t.dueDate, 'due_date_invalid');
    if (!isNonEmptyString(t.recipientId)) throw new ReminderEngineError('recipient_required');
    if (t.completed) continue;

    for (const rule of policy.rules) {
      let fire = ruleFireBase(t.dueDate, rule, cal);
      if (deferFire && cal) fire = deferToWorkday(fire, cal);
      // 提前提醒不應晚於到期日（遞延後若越過 dueDate 則夾回）。
      if (rule.kind === ReminderKind.LEAD && fire.getTime() > t.dueDate.getTime()) {
        fire = t.dueDate;
      }
      const channels = rule.channels ?? t.channels ?? policy.defaultChannels;
      for (const channel of channels) {
        const fireIso = toIsoDate(fire);
        out.push({
          dedupKey: `${t.key}|${t.recipientId}|${offsetTag(rule)}|${channel}|${fireIso}`,
          targetKey: t.key,
          label: t.label,
          step: t.step,
          recipientId: t.recipientId,
          channel,
          kind: rule.kind,
          dueDate: t.dueDate,
          fireDate: fire,
          formCodes: [...(t.formCodes ?? [])],
        });
      }
    }
  }
  return out.sort((a, b) => {
    const f = a.fireDate.getTime() - b.fireDate.getTime();
    if (f !== 0) return f;
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.channel.localeCompare(b.channel);
  });
}

/** 便利建構：由「已排程的時間點」（結構型別，與 onboarding 解耦）建立提醒對象。 */
export interface ScheduledLike {
  step?: string;
  label: string;
  /** 已套用遞延的計畫日。 */
  plannedDate: Date;
  formCodes?: readonly string[];
  completed?: boolean;
}

/**
 * 由排程時間點 + 收件者建立 ReminderTarget[]（key 預設 `${keyPrefix}:${step|label}`）。
 * 用於串接 onboarding.buildSchedule / calendar.reschedule 的輸出，無需 import 對方型別。
 */
export function targetsFromSchedule(
  items: readonly ScheduledLike[],
  recipientId: string,
  opts: { keyPrefix: string; channels?: readonly ReminderChannel[] },
): ReminderTarget[] {
  if (!isNonEmptyString(recipientId)) throw new ReminderEngineError('recipient_required');
  return items.map((it) => ({
    key: `${opts.keyPrefix}:${it.step ?? it.label}`,
    label: it.label,
    dueDate: it.plannedDate,
    recipientId,
    channels: opts.channels,
    formCodes: it.formCodes,
    step: it.step,
    completed: it.completed,
  }));
}

/* ────────────────────────── 到期挑選（供主動派送） ────────────────────────── */

/** 已挑選、應於「現在」派送的提醒（附時間相關欄位）。 */
export interface DueReminder extends ReminderOccurrence {
  /** 距到期日的天數（負數＝已逾期，以 UTC 日界計）。 */
  daysUntilDue: number;
  /** 是否已逾期（now > dueDate）。 */
  overdue: boolean;
}

export interface SelectDueOptions {
  now?: Date;
  /** 已派送過的 dedupKey 集合（跨輪去重；本輪不再重送）。 */
  alreadySent?: ReadonlySet<string>;
}

/**
 * 從所有 occurrence 中挑出「fireDate 已到（<= now）且未派送過、對象未完成」者（§8.3 主動提醒）。
 * 回傳依 fireDate 由早到晚排序，供服務層派送並記錄 dedupKey。
 */
export function selectDueReminders(
  occurrences: readonly ReminderOccurrence[],
  opts: SelectDueOptions = {},
): DueReminder[] {
  const now = opts.now ?? new Date();
  assertValidDate(now, 'due_date_invalid');
  const sent = opts.alreadySent ?? new Set<string>();
  const due: DueReminder[] = [];
  for (const o of occurrences) {
    if (o.fireDate.getTime() > now.getTime()) continue;
    if (sent.has(o.dedupKey)) continue;
    due.push({
      ...o,
      daysUntilDue: calendarDaysBetween(now, o.dueDate),
      overdue: now.getTime() > o.dueDate.getTime(),
    });
  }
  return due.sort((a, b) => a.fireDate.getTime() - b.fireDate.getTime());
}

/* ────────────────────────── 通知內容組裝 ────────────────────────── */

/** 一則可派送的通知訊息（管道無關）。 */
export interface ReminderMessage {
  dedupKey: string;
  channel: ReminderChannel;
  recipientId: string;
  targetKey: string;
  kind: ReminderKind;
  title: string;
  body: string;
  dueDate: Date;
  fireDate: Date;
  formCodes: string[];
}

/** 以繁中組裝提醒標題 / 內文（依種類）。 */
export function buildReminderMessage(o: ReminderOccurrence): ReminderMessage {
  const dueIso = toIsoDate(o.dueDate);
  const forms = o.formCodes.length ? `；應完成表單：${o.formCodes.join('、')}` : '';
  let title: string;
  let body: string;
  switch (o.kind) {
    case ReminderKind.LEAD:
      title = `【提前提醒】${o.label}`;
      body = `任務「${o.label}」預計於 ${dueIso} 到期，請提前準備${forms}。`;
      break;
    case ReminderKind.DUE:
      title = `【今日到期】${o.label}`;
      body = `任務「${o.label}」今日（${dueIso}）到期，請完成應辦事項${forms}。`;
      break;
    case ReminderKind.OVERDUE:
    default:
      title = `【逾期提醒】${o.label}`;
      body = `任務「${o.label}」已於 ${dueIso} 到期且尚未完成，請儘速處理${forms}。`;
      break;
  }
  return {
    dedupKey: o.dedupKey,
    channel: o.channel,
    recipientId: o.recipientId,
    targetKey: o.targetKey,
    kind: o.kind,
    title,
    body,
    dueDate: o.dueDate,
    fireDate: o.fireDate,
    formCodes: [...o.formCodes],
  };
}

/* ────────────────────────── 派送抽象（可插拔 dispatcher） ────────────────────────── */

/** 單筆派送結果。 */
export interface DispatchResult {
  dedupKey: string;
  channel: ReminderChannel;
  recipientId: string;
  ok: boolean;
  /** 失敗 / 未路由原因（如 no_dispatcher_for_channel）。 */
  error?: string;
}

/** 派送器介面：實作某管道的送信。IN_APP 可於本輪落地；EMAIL / OTHER 待 §12-7 接外部服務。 */
export interface ReminderDispatcher {
  readonly channel: ReminderChannel;
  send(message: ReminderMessage): Promise<DispatchResult> | DispatchResult;
}

/**
 * 將一批提醒派送到對應管道的 dispatcher。
 * - 找不到該管道的 dispatcher → 回 ok:false, error:`no_dispatcher_for_channel:<CHANNEL>`（不丟錯，便於部分管道尚未接通時仍可派送其餘）。
 * - dispatcher 內部丟錯 → 捕捉為 ok:false, error:<message>。
 * 回傳與輸入等長、同序的結果陣列。
 */
export async function dispatchReminders(
  occurrences: readonly ReminderOccurrence[],
  dispatchers: readonly ReminderDispatcher[],
): Promise<DispatchResult[]> {
  const byChannel = new Map<ReminderChannel, ReminderDispatcher>();
  for (const d of dispatchers) byChannel.set(d.channel, d);
  const results: DispatchResult[] = [];
  for (const o of occurrences) {
    const dispatcher = byChannel.get(o.channel);
    if (!dispatcher) {
      results.push({ dedupKey: o.dedupKey, channel: o.channel, recipientId: o.recipientId, ok: false, error: `no_dispatcher_for_channel:${o.channel}` });
      continue;
    }
    try {
      results.push(await dispatcher.send(buildReminderMessage(o)));
    } catch (err) {
      results.push({ dedupKey: o.dedupKey, channel: o.channel, recipientId: o.recipientId, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

/** 收集型 dispatcher：把訊息收進陣列即視為成功，供測試與「系統內通知」由服務層接手落地。 */
export interface CollectorDispatcher extends ReminderDispatcher {
  readonly sent: ReminderMessage[];
}

/** 建立某管道的收集型 dispatcher（預設 IN_APP）。 */
export function createCollectorDispatcher(channel: ReminderChannel = ReminderChannel.IN_APP): CollectorDispatcher {
  const sent: ReminderMessage[] = [];
  return {
    channel,
    sent,
    send(message: ReminderMessage): DispatchResult {
      sent.push(message);
      return { dedupKey: message.dedupKey, channel, recipientId: message.recipientId, ok: true };
    },
  };
}

/* ────────────────────────── 去重日誌序列化 ────────────────────────── */

/** 派送日誌的 JSON-safe 表達（存入 FormSubmission.data，供跨輪去重）。 */
export interface DispatchLogData {
  dedupKey: string;
  targetKey: string;
  recipientId: string;
  channel: ReminderChannel;
  kind: ReminderKind;
  fireIsoDate: string;
  dueIsoDate: string;
}

/** 由 occurrence 組出派送日誌資料。 */
export function toDispatchLog(o: ReminderOccurrence): DispatchLogData {
  return {
    dedupKey: o.dedupKey,
    targetKey: o.targetKey,
    recipientId: o.recipientId,
    channel: o.channel,
    kind: o.kind,
    fireIsoDate: toIsoDate(o.fireDate),
    dueIsoDate: toIsoDate(o.dueDate),
  };
}

/** 還原派送日誌；毀損資料丟 occurrence_corrupt。 */
export function fromDispatchLog(data: unknown): DispatchLogData {
  if (!data || typeof data !== 'object') throw new ReminderEngineError('occurrence_corrupt');
  const d = data as Partial<DispatchLogData>;
  if (!isNonEmptyString(d.dedupKey) || !isNonEmptyString(d.targetKey) || !isNonEmptyString(d.recipientId)) {
    throw new ReminderEngineError('occurrence_corrupt');
  }
  const channelOk = (Object.values(ReminderChannel) as string[]).includes(d.channel as string);
  const kindOk = (Object.values(ReminderKind) as string[]).includes(d.kind as string);
  if (!channelOk || !kindOk) throw new ReminderEngineError('occurrence_corrupt');
  return {
    dedupKey: d.dedupKey,
    targetKey: d.targetKey,
    recipientId: d.recipientId,
    channel: d.channel as ReminderChannel,
    kind: d.kind as ReminderKind,
    fireIsoDate: isNonEmptyString(d.fireIsoDate) ? d.fireIsoDate : '',
    dueIsoDate: isNonEmptyString(d.dueIsoDate) ? d.dueIsoDate : '',
  };
}
