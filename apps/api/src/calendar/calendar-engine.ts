/**
 * 行事曆遞延引擎核心（純領域邏輯，無 DB / Nest 相依）。
 *
 * 對應需求規格 §8.3「行事曆整合：自動判斷國定假日 / 連假，避免任務排程落在假期；
 * 必要時自動遞延並重算時程」，並支援 §10.5 專案層級行事曆排除日（以注入 predicate 套用）。
 *
 * 設計沿用 workflow / forms / templates / attachments / sales / onboarding / environment /
 * customization 引擎之「純引擎 + Service」風格：本檔僅負責「曆法判斷與時程重算」決策，
 * 不接觸資料庫，可被純函式單元測試完整覆蓋。CalendarService 再以 Prisma 載入
 * 公司自訂假日 / 專案排除日，組出 predicate 套用至本引擎。
 *
 * 既有銜接點：onboarding-engine `buildSchedule(anchor, checkpoints, isExcluded)` 已預留
 * `isExcluded(date) => boolean` 注入點（預設 identity，曆法來源待 4.1）。本引擎之
 * `buildExcludedPredicate(...)` 即可作為該參數注入，達成「遇連假自動遞延、時程重算」。
 *
 * 日界一律以 UTC 判斷（toIsoDate / parseIsoDate 使用 getUTC*），避免執行環境時區造成
 * 跨日誤差；呼叫端建議以 UTC 午夜（如 new Date('2026-01-01')）作為日期錨點。
 */

export class CalendarEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarEngineError';
  }
}

/** ISO 日期字串 yyyy-mm-dd（僅日期、不含時間，以 UTC 日界判斷）。 */
export type IsoDate = string;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ────────────────────────── 日期工具 ────────────────────────── */

/** 將 Date 轉為 yyyy-mm-dd（UTC）。非法日期拋 calendar_date_invalid。 */
export function toIsoDate(d: Date): IsoDate {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new CalendarEngineError('calendar_date_invalid');
  }
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 解析 yyyy-mm-dd 為 UTC 午夜 Date。格式 / 數值不合法拋 calendar_date_invalid。 */
export function parseIsoDate(s: IsoDate): Date {
  if (typeof s !== 'string' || !ISO_DATE_RE.test(s)) {
    throw new CalendarEngineError('calendar_date_invalid');
  }
  const [y, m, day] = s.split('-').map((p) => Number.parseInt(p, 10));
  const d = new Date(Date.UTC(y, m - 1, day));
  // 反查避免如 2026-02-30 這類溢位被默默接受。
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== day) {
    throw new CalendarEngineError('calendar_date_invalid');
  }
  return d;
}

/** 回傳 base 之後 days 天的新 Date（保留時間，純 ms 位移）。 */
export function addDays(base: Date, days: number): Date {
  if (!(base instanceof Date) || Number.isNaN(base.getTime())) {
    throw new CalendarEngineError('calendar_date_invalid');
  }
  if (!Number.isInteger(days)) {
    throw new CalendarEngineError('calendar_days_invalid');
  }
  return new Date(base.getTime() + days * MS_PER_DAY);
}

/** 兩日期相差幾個曆日（b - a，依 UTC 日界，無條件取相差整日數）。 */
export function calendarDaysBetween(a: Date, b: Date): number {
  const a0 = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const b0 = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((b0 - a0) / MS_PER_DAY);
}

/** 星期幾（0=日 .. 6=六，UTC）。 */
export function weekdayOf(d: Date): number {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new CalendarEngineError('calendar_date_invalid');
  }
  return d.getUTCDay();
}

/* ────────────────────────── 假日行事曆 ────────────────────────── */

/** 建構行事曆之輸入（公司自訂 / 政府行事曆來源皆轉為此結構）。 */
export interface HolidayCalendarInput {
  /** 假日日期（國定假日 / 連假 / 公司自訂放假），yyyy-mm-dd。 */
  holidays?: readonly IsoDate[];
  /** 補班日（原為週末但政府公告補上班），yyyy-mm-dd；使該日視為工作日。 */
  makeupWorkdays?: readonly IsoDate[];
  /** 視為週末（非工作日）的星期（0=日 .. 6=六）。預設週六、週日 [0, 6]。 */
  weekendDays?: readonly number[];
}

/** 正規化後的行事曆（不可變）。 */
export interface HolidayCalendar {
  readonly holidays: ReadonlySet<IsoDate>;
  readonly makeupWorkdays: ReadonlySet<IsoDate>;
  readonly weekendDays: ReadonlySet<number>;
}

const DEFAULT_WEEKEND_DAYS: readonly number[] = [0, 6];

/**
 * 由輸入建構正規化行事曆。
 * - 每個日期字串需為合法 yyyy-mm-dd，否則拋 calendar_date_invalid。
 * - weekendDays 需為 0..6 整數，否則拋 calendar_weekend_invalid。
 * - 衝突處理：若同一日同時被列為 holiday 與 makeupWorkday，holiday 優先（視為放假），
 *   以符合「政府宣布放假」之直覺；此情形通常為資料錯誤，呼叫端應避免。
 */
export function buildCalendar(input: HolidayCalendarInput = {}): HolidayCalendar {
  const holidays = new Set<IsoDate>();
  for (const h of input.holidays ?? []) {
    holidays.add(toIsoDate(parseIsoDate(h)));
  }
  const makeupWorkdays = new Set<IsoDate>();
  for (const w of input.makeupWorkdays ?? []) {
    const key = toIsoDate(parseIsoDate(w));
    if (!holidays.has(key)) makeupWorkdays.add(key);
  }
  const weekendDays = new Set<number>();
  for (const d of input.weekendDays ?? DEFAULT_WEEKEND_DAYS) {
    if (!Number.isInteger(d) || d < 0 || d > 6) {
      throw new CalendarEngineError('calendar_weekend_invalid');
    }
    weekendDays.add(d);
  }
  return Object.freeze({
    holidays: holidays as ReadonlySet<IsoDate>,
    makeupWorkdays: makeupWorkdays as ReadonlySet<IsoDate>,
    weekendDays: weekendDays as ReadonlySet<number>,
  });
}

/** 合併多個行事曆（假日 / 補班 / 週末取聯集；補班與假日衝突時假日優先）。 */
export function mergeCalendars(...cals: readonly HolidayCalendar[]): HolidayCalendar {
  const holidays = new Set<IsoDate>();
  const makeupWorkdays = new Set<IsoDate>();
  const weekendDays = new Set<number>();
  for (const c of cals) {
    for (const h of c.holidays) holidays.add(h);
    for (const w of c.makeupWorkdays) makeupWorkdays.add(w);
    for (const d of c.weekendDays) weekendDays.add(d);
  }
  for (const h of holidays) makeupWorkdays.delete(h); // 假日優先
  return Object.freeze({
    holidays: holidays as ReadonlySet<IsoDate>,
    makeupWorkdays: makeupWorkdays as ReadonlySet<IsoDate>,
    weekendDays: weekendDays as ReadonlySet<number>,
  });
}

/* ────────────────────────── 工作日判斷 ────────────────────────── */

/** 該日是否為週末（依行事曆設定之 weekendDays）。 */
export function isWeekend(d: Date, cal: HolidayCalendar): boolean {
  return cal.weekendDays.has(weekdayOf(d));
}

/** 該日是否為假日（在 holidays 集合內）。 */
export function isHoliday(d: Date, cal: HolidayCalendar): boolean {
  return cal.holidays.has(toIsoDate(d));
}

/** 該日是否為補班日（原週末但補上班）。 */
export function isMakeupWorkday(d: Date, cal: HolidayCalendar): boolean {
  return cal.makeupWorkdays.has(toIsoDate(d));
}

/**
 * 該日是否為工作日。
 * 判斷順序：補班日 → 工作日；假日 → 非工作日；週末 → 非工作日；其餘 → 工作日。
 */
export function isWorkday(d: Date, cal: HolidayCalendar): boolean {
  if (isMakeupWorkday(d, cal)) return true;
  if (isHoliday(d, cal)) return false;
  if (isWeekend(d, cal)) return false;
  return true;
}

/** 該日是否為非工作日（工作日之反）。 */
export function isNonWorkday(d: Date, cal: HolidayCalendar): boolean {
  return !isWorkday(d, cal);
}

/**
 * 建立可注入 onboarding `buildSchedule` 等排程器的 `isExcluded(date) => boolean`。
 * 規則：非工作日（週末 / 假日，補班除外）→ 排除；或命中 extraExcluded（如專案排除日）→ 排除。
 */
export function buildExcludedPredicate(
  cal: HolidayCalendar,
  extraExcluded?: (date: Date) => boolean,
): (date: Date) => boolean {
  return (date: Date) => isNonWorkday(date, cal) || (extraExcluded ? extraExcluded(date) : false);
}

/* ────────────────────────── 工作日運算 / 遞延 ────────────────────────── */

const DEFER_GUARD = 366;

/**
 * 將日期遞延至「最近且在當日（含）之後」的工作日：若已是工作日則原樣回傳，
 * 否則逐日 +1 直到工作日（§8.3 自動遞延、§5.3）。
 * extraExcluded 視為等同非工作日（如專案排除日 §10.5）。
 * 連續超過 DEFER_GUARD 天找不到工作日拋 calendar_no_workday（避免無限迴圈 / 行事曆全為假日）。
 */
export function deferToWorkday(
  d: Date,
  cal: HolidayCalendar,
  extraExcluded?: (date: Date) => boolean,
): Date {
  const blocked = (x: Date) => isNonWorkday(x, cal) || (extraExcluded ? extraExcluded(x) : false);
  let cur = d;
  let guard = 0;
  while (blocked(cur)) {
    cur = addDays(cur, 1);
    guard += 1;
    if (guard > DEFER_GUARD) throw new CalendarEngineError('calendar_no_workday');
  }
  return cur;
}

/** 嚴格「下一個」工作日（必往後至少一天）。 */
export function nextWorkday(
  d: Date,
  cal: HolidayCalendar,
  extraExcluded?: (date: Date) => boolean,
): Date {
  return deferToWorkday(addDays(d, 1), cal, extraExcluded);
}

/** 嚴格「上一個」工作日（必往前至少一天）。 */
export function previousWorkday(
  d: Date,
  cal: HolidayCalendar,
  extraExcluded?: (date: Date) => boolean,
): Date {
  const blocked = (x: Date) => isNonWorkday(x, cal) || (extraExcluded ? extraExcluded(x) : false);
  let cur = addDays(d, -1);
  let guard = 0;
  while (blocked(cur)) {
    cur = addDays(cur, -1);
    guard += 1;
    if (guard > DEFER_GUARD) throw new CalendarEngineError('calendar_no_workday');
  }
  return cur;
}

/**
 * 自 start 起算 n 個工作日（n 可為負）。
 * - start 先遞延至工作日（往後）作為第 0 個工作日基準。
 * - n > 0：往後跳 n 個工作日；n < 0：往前跳 |n| 個工作日；n = 0：回傳基準工作日。
 * 用於「整體後推」模式：位移以工作日計，連假整段自然把後續時間點往後擠。
 */
export function addBusinessDays(
  start: Date,
  n: number,
  cal: HolidayCalendar,
  extraExcluded?: (date: Date) => boolean,
): Date {
  if (!Number.isInteger(n)) throw new CalendarEngineError('calendar_days_invalid');
  let cur = deferToWorkday(start, cal, extraExcluded);
  const step = n >= 0 ? 1 : -1;
  let remaining = Math.abs(n);
  while (remaining > 0) {
    cur = step > 0 ? nextWorkday(cur, cal, extraExcluded) : previousWorkday(cur, cal, extraExcluded);
    remaining -= 1;
  }
  return cur;
}

/** 計算 (a, b] 之間的工作日數（含 b、不含 a；b 早於 a 則回負）。 */
export function businessDaysBetween(a: Date, b: Date, cal: HolidayCalendar): number {
  const diff = calendarDaysBetween(a, b);
  if (diff === 0) return 0;
  const step = diff > 0 ? 1 : -1;
  let count = 0;
  let cur = a;
  for (let i = 0; i < Math.abs(diff); i += 1) {
    cur = addDays(cur, step);
    if (isWorkday(cur, cal)) count += step;
  }
  return count;
}

/* ────────────────────────── 時程重算（遞延模式） ────────────────────────── */

/** 遞延模式（§12-5 待釐清：兩種規則皆提供，由呼叫端 / 政策選用）。 */
export enum DeferralMode {
  /** 順延下一工作日：各時間點各自獨立遞延，不影響其後時間點之位移基準。 */
  NEXT_WORKDAY = 'NEXT_WORKDAY',
  /** 整體後推：位移以「工作日」計，連假整段把其後時間點一併往後推遲。 */
  PUSH_FORWARD = 'PUSH_FORWARD',
}

/** 時程時間點輸入（key 為穩定識別碼，offsetDays 為距錨點之天數）。 */
export interface CheckpointOffset {
  key: string;
  /** 距錨點之位移（NEXT_WORKDAY 模式以曆日計、PUSH_FORWARD 模式以工作日計）。需為非負整數。 */
  offsetDays: number;
}

/** 重算後之時間點。 */
export interface RescheduledCheckpoint {
  key: string;
  offsetDays: number;
  /** 未套用遞延前之原始計畫日（anchor + offsetDays 曆日）。 */
  originalDate: Date;
  /** 套用遞延 / 重算後之計畫工作日。 */
  plannedDate: Date;
  /** plannedDate 相對 originalDate 之遞延曆日數（>= 0）。 */
  deferredDays: number;
}

/**
 * 依錨點 + 各時間點位移，套用行事曆遞延重算絕對計畫日（§8.3）。
 * - anchor 必填且為合法日期；offsetDays 需為非負整數，否則拋對應錯誤。
 * - NEXT_WORKDAY：planned = deferToWorkday(anchor + offset 曆日)。各點獨立。
 * - PUSH_FORWARD：planned = addBusinessDays(anchor, offset)。連假會把後續時間點一併後推。
 * - extraExcluded：額外排除日（如專案排除日 §10.5），視為非工作日參與遞延。
 * 回傳依 plannedDate 由早到晚排序。
 */
export function reschedule(
  anchor: Date,
  checkpoints: readonly CheckpointOffset[],
  cal: HolidayCalendar,
  mode: DeferralMode = DeferralMode.NEXT_WORKDAY,
  extraExcluded?: (date: Date) => boolean,
): RescheduledCheckpoint[] {
  if (!(anchor instanceof Date) || Number.isNaN(anchor.getTime())) {
    throw new CalendarEngineError('calendar_anchor_required');
  }
  const out: RescheduledCheckpoint[] = [];
  for (const c of checkpoints) {
    if (!Number.isInteger(c.offsetDays) || c.offsetDays < 0) {
      throw new CalendarEngineError('calendar_offset_invalid');
    }
    const originalDate = addDays(anchor, c.offsetDays);
    const plannedDate =
      mode === DeferralMode.PUSH_FORWARD
        ? addBusinessDays(anchor, c.offsetDays, cal, extraExcluded)
        : deferToWorkday(originalDate, cal, extraExcluded);
    out.push({
      key: c.key,
      offsetDays: c.offsetDays,
      originalDate,
      plannedDate,
      deferredDays: calendarDaysBetween(originalDate, plannedDate),
    });
  }
  return out.sort((a, b) => a.plannedDate.getTime() - b.plannedDate.getTime());
}

/* ────────────────────────── 內建範例行事曆 ────────────────────────── */

/**
 * 範例：台灣 2026 年「固定日期」國定假日（僅高信心之固定日，供開發 / 預設兜底）。
 *
 * ⚠️ 重要：農曆假日（春節 / 端午 / 中秋）與其連假天數、彈性放假、補班日，每年由政府公告且
 * 多為農曆換算，無法以固定日表達；務必由 CalendarService 以「政府行事曆 / 公司自訂」來源
 * 載入校正（見 issue #21 補充與 §12-5）。本常數僅含西曆固定日，避免提供不準確的農曆假日。
 */
export const SAMPLE_TW_FIXED_HOLIDAYS_2026: readonly IsoDate[] = Object.freeze([
  '2026-01-01', // 中華民國開國紀念日（元旦）
  '2026-02-28', // 和平紀念日
  '2026-04-04', // 兒童節
  '2026-04-05', // 清明節（西曆固定近似，實際以公告為準）
  '2026-05-01', // 勞動節
  '2026-10-10', // 國慶日
]);
