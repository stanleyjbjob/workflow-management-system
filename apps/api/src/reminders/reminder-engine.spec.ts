import {
  DEFAULT_REMINDER_POLICY,
  ReminderChannel,
  ReminderEngineError,
  ReminderKind,
  ReminderPolicy,
  ReminderTarget,
  buildReminderMessage,
  computeReminderOccurrences,
  createCollectorDispatcher,
  dispatchReminders,
  fromDispatchLog,
  selectDueReminders,
  targetsFromSchedule,
  toDispatchLog,
} from './reminder-engine';
import { buildCalendar, parseIsoDate, toIsoDate } from '../calendar/calendar-engine';

const d = (iso: string) => parseIsoDate(iso);
// 僅週末的行事曆（無假日），便於推算工作日。2026-06-06 為週六。
const cal = buildCalendar();

const baseTarget = (over: Partial<ReminderTarget> = {}): ReminderTarget => ({
  key: 'case1:KICKOFF',
  label: '啟動會議',
  dueDate: d('2026-06-12'), // 週五
  recipientId: 'user-1',
  formCodes: ['ONBOARDING_KICKOFF_MINUTES'],
  step: 'KICKOFF',
  ...over,
});

describe('computeReminderOccurrences 預設政策', () => {
  it('展開 LEAD(3w)/LEAD(1w)/DUE/OVERDUE(1w) × IN_APP 共 4 筆', () => {
    const occ = computeReminderOccurrences([baseTarget()], DEFAULT_REMINDER_POLICY, cal);
    expect(occ).toHaveLength(4);
    expect(occ.every((o) => o.channel === ReminderChannel.IN_APP)).toBe(true);
  });

  it('提醒日由「到期日」推導（工作日計）', () => {
    const occ = computeReminderOccurrences([baseTarget()], DEFAULT_REMINDER_POLICY, cal);
    const byKind = (k: ReminderKind, tag: string) =>
      occ.find((o) => o.kind === k && o.dedupKey.includes(tag))!;
    // 到期 06-12(五)：前3工作日=06-09(二)、前1工作日=06-11(四)、到期=06-12、逾期+1工作日=06-15(一)
    expect(toIsoDate(byKind(ReminderKind.LEAD, 'LEAD-3w').fireDate)).toBe('2026-06-09');
    expect(toIsoDate(byKind(ReminderKind.LEAD, 'LEAD-1w').fireDate)).toBe('2026-06-11');
    expect(toIsoDate(byKind(ReminderKind.DUE, 'DUE-0c').fireDate)).toBe('2026-06-12');
    expect(toIsoDate(byKind(ReminderKind.OVERDUE, 'OVERDUE-1w').fireDate)).toBe('2026-06-15');
  });

  it('LEAD 提醒日恆不晚於到期日', () => {
    const occ = computeReminderOccurrences([baseTarget()], DEFAULT_REMINDER_POLICY, cal);
    for (const o of occ.filter((x) => x.kind === ReminderKind.LEAD)) {
      expect(o.fireDate.getTime() <= o.dueDate.getTime()).toBe(true);
    }
  });

  it('已完成的對象不產生提醒', () => {
    const occ = computeReminderOccurrences([baseTarget({ completed: true })], DEFAULT_REMINDER_POLICY, cal);
    expect(occ).toHaveLength(0);
  });

  it('遞延後提醒時間同步調整：到期日改變則 DUE 提醒日同步改變', () => {
    const a = computeReminderOccurrences([baseTarget({ dueDate: d('2026-06-12') })], DEFAULT_REMINDER_POLICY, cal);
    const b = computeReminderOccurrences([baseTarget({ dueDate: d('2026-06-19') })], DEFAULT_REMINDER_POLICY, cal);
    const dueA = a.find((o) => o.kind === ReminderKind.DUE)!;
    const dueB = b.find((o) => o.kind === ReminderKind.DUE)!;
    expect(toIsoDate(dueA.fireDate)).toBe('2026-06-12');
    expect(toIsoDate(dueB.fireDate)).toBe('2026-06-19'); // 隨到期日順移一週
  });

  it('提醒日若落在假日會遞延至工作日', () => {
    // 到期 06-19(五)，前1工作日為 06-18(四)；若 06-18 為假日則提前提醒應落 06-17(三)
    const calH = buildCalendar({ holidays: ['2026-06-18'] });
    const occ = computeReminderOccurrences([baseTarget({ dueDate: d('2026-06-19') })], DEFAULT_REMINDER_POLICY, calH);
    const lead1 = occ.find((o) => o.dedupKey.includes('LEAD-1w'))!;
    expect(toIsoDate(lead1.fireDate)).toBe('2026-06-17');
  });
});

describe('管道解析（rule > target > policy 預設）', () => {
  it('rule.channels 優先', () => {
    const policy: ReminderPolicy = {
      rules: [{ kind: ReminderKind.DUE, offsetDays: 0, channels: [ReminderChannel.EMAIL] }],
      defaultChannels: [ReminderChannel.IN_APP],
    };
    const occ = computeReminderOccurrences([baseTarget({ channels: [ReminderChannel.OTHER] })], policy, cal);
    expect(occ).toHaveLength(1);
    expect(occ[0].channel).toBe(ReminderChannel.EMAIL);
  });

  it('rule 未指定則回退 target.channels', () => {
    const policy: ReminderPolicy = {
      rules: [{ kind: ReminderKind.DUE, offsetDays: 0 }],
      defaultChannels: [ReminderChannel.IN_APP],
    };
    const occ = computeReminderOccurrences([baseTarget({ channels: [ReminderChannel.EMAIL] })], policy, cal);
    expect(occ[0].channel).toBe(ReminderChannel.EMAIL);
  });

  it('多管道展開為多筆 occurrence', () => {
    const policy: ReminderPolicy = {
      rules: [{ kind: ReminderKind.DUE, offsetDays: 0, channels: [ReminderChannel.IN_APP, ReminderChannel.EMAIL] }],
      defaultChannels: [ReminderChannel.IN_APP],
    };
    const occ = computeReminderOccurrences([baseTarget()], policy, cal);
    expect(occ).toHaveLength(2);
    expect(occ.map((o) => o.channel).sort()).toEqual([ReminderChannel.EMAIL, ReminderChannel.IN_APP]);
  });
});

describe('dedup 與 selectDueReminders', () => {
  it('dedupKey 唯一', () => {
    const occ = computeReminderOccurrences([baseTarget()], DEFAULT_REMINDER_POLICY, cal);
    const keys = new Set(occ.map((o) => o.dedupKey));
    expect(keys.size).toBe(occ.length);
  });

  it('依 now 挑出已到的提醒，並計算 daysUntilDue / overdue', () => {
    const occ = computeReminderOccurrences([baseTarget()], DEFAULT_REMINDER_POLICY, cal);
    // now = 06-12 當天：fire<=06-12 者為 LEAD-3w(06-09)/LEAD-1w(06-11)/DUE(06-12)
    const due = selectDueReminders(occ, { now: d('2026-06-12') });
    expect(due).toHaveLength(3);
    const dueItem = due.find((o) => o.kind === ReminderKind.DUE)!;
    expect(dueItem.daysUntilDue).toBe(0);
    expect(dueItem.overdue).toBe(false);
  });

  it('alreadySent 的 dedupKey 不再挑出（跨輪去重）', () => {
    const occ = computeReminderOccurrences([baseTarget()], DEFAULT_REMINDER_POLICY, cal);
    const due1 = selectDueReminders(occ, { now: d('2026-06-12') });
    const sent = new Set(due1.map((o) => o.dedupKey));
    const due2 = selectDueReminders(occ, { now: d('2026-06-12'), alreadySent: sent });
    expect(due2).toHaveLength(0);
  });

  it('逾期提醒於到期後被挑出且 overdue=true', () => {
    const occ = computeReminderOccurrences([baseTarget()], DEFAULT_REMINDER_POLICY, cal);
    const due = selectDueReminders(occ, { now: d('2026-06-15') });
    const ov = due.find((o) => o.kind === ReminderKind.OVERDUE)!;
    expect(ov.overdue).toBe(true);
    expect(ov.daysUntilDue).toBe(-3); // 06-15 距 06-12
  });
});

describe('buildReminderMessage', () => {
  it('依種類組裝標題並帶入表單代碼', () => {
    const occ = computeReminderOccurrences([baseTarget()], DEFAULT_REMINDER_POLICY, cal);
    const msgDue = buildReminderMessage(occ.find((o) => o.kind === ReminderKind.DUE)!);
    expect(msgDue.title).toContain('今日到期');
    expect(msgDue.title).toContain('啟動會議');
    expect(msgDue.body).toContain('ONBOARDING_KICKOFF_MINUTES');
    const msgLead = buildReminderMessage(occ.find((o) => o.kind === ReminderKind.LEAD)!);
    expect(msgLead.title).toContain('提前提醒');
    const msgOver = buildReminderMessage(occ.find((o) => o.kind === ReminderKind.OVERDUE)!);
    expect(msgOver.title).toContain('逾期提醒');
  });
});

describe('dispatchReminders 派送抽象', () => {
  it('IN_APP collector 成功收集；EMAIL 無 dispatcher 回未路由', async () => {
    const policy: ReminderPolicy = {
      rules: [{ kind: ReminderKind.DUE, offsetDays: 0, channels: [ReminderChannel.IN_APP, ReminderChannel.EMAIL] }],
      defaultChannels: [ReminderChannel.IN_APP],
    };
    const occ = computeReminderOccurrences([baseTarget()], policy, cal);
    const collector = createCollectorDispatcher(ReminderChannel.IN_APP);
    const results = await dispatchReminders(occ, [collector]);
    expect(results).toHaveLength(2);
    const inApp = results.find((r) => r.channel === ReminderChannel.IN_APP)!;
    const email = results.find((r) => r.channel === ReminderChannel.EMAIL)!;
    expect(inApp.ok).toBe(true);
    expect(collector.sent).toHaveLength(1);
    expect(email.ok).toBe(false);
    expect(email.error).toBe('no_dispatcher_for_channel:EMAIL');
  });

  it('dispatcher 丟錯被捕捉為 ok:false', async () => {
    const occ = computeReminderOccurrences([baseTarget()], DEFAULT_REMINDER_POLICY, cal);
    const boom = {
      channel: ReminderChannel.IN_APP,
      send() { throw new Error('smtp_down'); },
    };
    const results = await dispatchReminders(occ.slice(0, 1), [boom]);
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toBe('smtp_down');
  });
});

describe('派送日誌序列化', () => {
  it('toDispatchLog / fromDispatchLog round-trip', () => {
    const occ = computeReminderOccurrences([baseTarget()], DEFAULT_REMINDER_POLICY, cal);
    const log = toDispatchLog(occ[0]);
    const back = fromDispatchLog(JSON.parse(JSON.stringify(log)));
    expect(back.dedupKey).toBe(occ[0].dedupKey);
    expect(back.channel).toBe(occ[0].channel);
    expect(back.kind).toBe(occ[0].kind);
  });

  it('毀損資料丟 occurrence_corrupt', () => {
    expect(() => fromDispatchLog(null)).toThrow('occurrence_corrupt');
    expect(() => fromDispatchLog({ dedupKey: 'x' })).toThrow(ReminderEngineError);
    expect(() => fromDispatchLog({ dedupKey: 'x', targetKey: 't', recipientId: 'u', channel: 'BAD', kind: 'DUE' })).toThrow('occurrence_corrupt');
  });
});

describe('targetsFromSchedule 串接排程輸出', () => {
  it('由排程時間點建立提醒對象', () => {
    const schedule = [
      { step: 'PLAN', label: '導入規劃完成', plannedDate: d('2026-06-10'), formCodes: ['ONBOARDING_PLAN'] },
      { step: 'KICKOFF', label: '啟動會議', plannedDate: d('2026-06-15'), completed: true },
    ];
    const targets = targetsFromSchedule(schedule, 'user-9', { keyPrefix: 'case42' });
    expect(targets).toHaveLength(2);
    expect(targets[0].key).toBe('case42:PLAN');
    expect(toIsoDate(targets[0].dueDate)).toBe('2026-06-10');
    expect(targets[0].recipientId).toBe('user-9');
    expect(targets[1].completed).toBe(true);
    // 串接 compute：completed 者不產生提醒
    const occ = computeReminderOccurrences(targets, DEFAULT_REMINDER_POLICY, cal);
    expect(occ.some((o) => o.targetKey === 'case42:KICKOFF')).toBe(false);
  });
});

describe('輸入驗證', () => {
  it('缺 key / 非法到期日 / 缺收件者 / 非法 offset 拋對應錯誤', () => {
    expect(() => computeReminderOccurrences([baseTarget({ key: '' })], DEFAULT_REMINDER_POLICY, cal)).toThrow('target_invalid');
    expect(() => computeReminderOccurrences([baseTarget({ dueDate: new Date('x') })], DEFAULT_REMINDER_POLICY, cal)).toThrow('due_date_invalid');
    expect(() => computeReminderOccurrences([baseTarget({ recipientId: '' })], DEFAULT_REMINDER_POLICY, cal)).toThrow('recipient_required');
    const badPolicy: ReminderPolicy = { rules: [{ kind: ReminderKind.LEAD, offsetDays: -1 }], defaultChannels: [ReminderChannel.IN_APP] };
    expect(() => computeReminderOccurrences([baseTarget()], badPolicy, cal)).toThrow('rule_offset_invalid');
  });

  it('未提供行事曆時工作日規則退化為曆日（不丟錯）', () => {
    const occ = computeReminderOccurrences([baseTarget()], DEFAULT_REMINDER_POLICY);
    expect(occ.length).toBe(4);
  });
});
