/**
 * ReminderSchedulerService 接線測試（issue #32 / 7.2）。
 * Prisma / ReminderService / SMTP 傳輸皆以 stub 注入：驗證
 * - SMTP env 有無時的啟用 / 降級行為（EMAIL dispatcher 註冊與否）。
 * - 每日掃描逐案派送、channels 帶入（EMAIL 啟用時 IN_APP+EMAIL 並存）。
 * - 失敗彙整：派送失敗與整案丟錯都記入 failures、不中斷整輪。
 * - resolveUserEmail：停用帳號 / 查無使用者回 null。
 */

import { MailTransport, OutgoingMail } from './email-dispatcher';
import { DispatchResult, DueReminder, ReminderChannel, ReminderDispatcher } from './reminder-engine';
import { ReminderSchedulerService, REMINDER_CRON_DEFAULT } from './reminder-scheduler.service';
import { ReminderService } from './reminder.service';

/* ────────────────────────── stubs ────────────────────────── */

interface UserRow {
  email: string;
  isActive: boolean;
}

function makePrismaStub(opts: {
  users?: Record<string, UserRow>;
  stepCaseIds?: string[];
}): { prisma: unknown; calls: { findManyArgs: unknown[] } } {
  const calls = { findManyArgs: [] as unknown[] };
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => opts.users?.[where.id] ?? null,
    },
    stepInstance: {
      findMany: async (args: unknown) => {
        calls.findManyArgs.push(args);
        return (opts.stepCaseIds ?? []).map((caseId) => ({ caseId }));
      },
    },
  };
  return { prisma, calls };
}

interface ReminderServiceStubState {
  registered: ReminderDispatcher[];
  dispatchCalls: Array<{ caseId: string; opts: { now?: Date; channels?: readonly ReminderChannel[] } }>;
}

function makeReminderServiceStub(
  perCase: Record<string, { dispatched: DispatchResult[]; due: DueReminder[] } | Error> = {},
): { service: ReminderService; state: ReminderServiceStubState } {
  const state: ReminderServiceStubState = { registered: [], dispatchCalls: [] };
  const service = {
    registerDispatcher(d: ReminderDispatcher) {
      state.registered.push(d);
    },
    async dispatchDueReminders(
      caseId: string,
      opts: { now?: Date; channels?: readonly ReminderChannel[] } = {},
    ) {
      state.dispatchCalls.push({ caseId, opts });
      const entry = perCase[caseId];
      if (entry instanceof Error) throw entry;
      return entry ?? { dispatched: [], due: [] };
    },
  } as unknown as ReminderService;
  return { service, state };
}

function okResult(dedupKey: string, channel: ReminderChannel): DispatchResult {
  return { dedupKey, channel, recipientId: 'u1', ok: true };
}

function failResult(dedupKey: string, channel: ReminderChannel, error: string): DispatchResult {
  return { dedupKey, channel, recipientId: 'u1', ok: false, error };
}

function dueStub(dedupKey: string): DueReminder {
  return {
    dedupKey,
    targetKey: 'c1:s1',
    label: '步驟',
    recipientId: 'u1',
    channel: ReminderChannel.IN_APP,
    kind: 'DUE',
    dueDate: new Date('2026-06-08'),
    fireDate: new Date('2026-06-08'),
    formCodes: [],
    daysUntilDue: 0,
    overdue: false,
  } as unknown as DueReminder;
}

const SMTP_ENV = { SMTP_HOST: 'mail.example.com', SMTP_USER: 'bot@example.com', SMTP_PASS: 'pw' };

function fakeTransportFactory(): {
  factory: () => MailTransport;
  sent: OutgoingMail[];
} {
  const sent: OutgoingMail[] = [];
  return {
    sent,
    factory: () => ({
      async sendMail(mail: OutgoingMail) {
        sent.push(mail);
      },
    }),
  };
}

function makeService(opts: {
  users?: Record<string, UserRow>;
  stepCaseIds?: string[];
  perCase?: Record<string, { dispatched: DispatchResult[]; due: DueReminder[] } | Error>;
}) {
  const { prisma } = makePrismaStub(opts);
  const { service: reminders, state } = makeReminderServiceStub(opts.perCase);
  const scheduler = new ReminderSchedulerService(prisma as never, reminders);
  return { scheduler, state };
}

/* ────────────────────────── tests ────────────────────────── */

describe('預設排程設定', () => {
  it('預設 cron 為每日 08:00', () => {
    expect(REMINDER_CRON_DEFAULT).toBe('0 8 * * *');
  });
});

describe('setupEmailDispatcher', () => {
  it('SMTP env 未設定 → 不註冊 dispatcher、emailEnabled=false（優雅降級）', () => {
    const { scheduler, state } = makeService({});
    const enabled = scheduler.setupEmailDispatcher({});
    expect(enabled).toBe(false);
    expect(scheduler.isEmailEnabled()).toBe(false);
    expect(state.registered).toHaveLength(0);
  });

  it('SMTP env 齊備 → 註冊 EMAIL dispatcher、emailEnabled=true', () => {
    const { scheduler, state } = makeService({});
    const { factory } = fakeTransportFactory();
    const enabled = scheduler.setupEmailDispatcher(SMTP_ENV, factory);
    expect(enabled).toBe(true);
    expect(scheduler.isEmailEnabled()).toBe(true);
    expect(state.registered).toHaveLength(1);
    expect(state.registered[0].channel).toBe(ReminderChannel.EMAIL);
  });

  it('註冊的 dispatcher 以 Prisma 解析收件人 email 並實際寄出', async () => {
    const { scheduler, state } = makeService({
      users: { u1: { email: 'user1@corp.com', isActive: true } },
    });
    const { factory, sent } = fakeTransportFactory();
    scheduler.setupEmailDispatcher(SMTP_ENV, factory);
    const dispatcher = state.registered[0];
    const result = await dispatcher.send({
      dedupKey: 'k1',
      channel: ReminderChannel.EMAIL,
      recipientId: 'u1',
      targetKey: 'c1:s1',
      kind: 'DUE',
      title: 'T',
      body: 'B',
      dueDate: new Date('2026-06-08'),
      fireDate: new Date('2026-06-08'),
      formCodes: [],
    } as never);
    expect(result.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('user1@corp.com');
  });
});

describe('resolveUserEmail', () => {
  it('正常使用者回 email；停用 / 查無回 null', async () => {
    const { scheduler } = makeService({
      users: {
        u1: { email: 'a@corp.com', isActive: true },
        u2: { email: 'b@corp.com', isActive: false },
      },
    });
    expect(await scheduler.resolveUserEmail('u1')).toBe('a@corp.com');
    expect(await scheduler.resolveUserEmail('u2')).toBeNull();
    expect(await scheduler.resolveUserEmail('nobody')).toBeNull();
  });
});

describe('runDailySweep', () => {
  it('無待掃案件 → 空摘要', async () => {
    const { scheduler } = makeService({ stepCaseIds: [] });
    const summary = await scheduler.runDailySweep(new Date('2026-06-08'));
    expect(summary.casesScanned).toBe(0);
    expect(summary.dueCount).toBe(0);
    expect(summary.sentCount).toBe(0);
    expect(summary.failedCount).toBe(0);
  });

  it('逐案呼叫 dispatchDueReminders 並彙整成功數', async () => {
    const { scheduler, state } = makeService({
      stepCaseIds: ['c1', 'c2'],
      perCase: {
        c1: { dispatched: [okResult('k1', ReminderChannel.IN_APP)], due: [dueStub('k1')] },
        c2: {
          dispatched: [okResult('k2', ReminderChannel.IN_APP), okResult('k3', ReminderChannel.IN_APP)],
          due: [dueStub('k2'), dueStub('k3')],
        },
      },
    });
    const now = new Date('2026-06-08');
    const summary = await scheduler.runDailySweep(now);
    expect(summary.casesScanned).toBe(2);
    expect(summary.dueCount).toBe(3);
    expect(summary.sentCount).toBe(3);
    expect(summary.failedCount).toBe(0);
    expect(state.dispatchCalls.map((c) => c.caseId)).toEqual(['c1', 'c2']);
    expect(state.dispatchCalls[0].opts.now).toBe(now);
  });

  it('EMAIL 未啟用 → channels 不帶（沿用引擎預設 IN_APP）', async () => {
    const { scheduler, state } = makeService({ stepCaseIds: ['c1'] });
    await scheduler.runDailySweep(new Date('2026-06-08'));
    expect(state.dispatchCalls[0].opts.channels).toBeUndefined();
  });

  it('EMAIL 啟用 → channels=[IN_APP, EMAIL]（兩管道並存）', async () => {
    const { scheduler, state } = makeService({ stepCaseIds: ['c1'] });
    const { factory } = fakeTransportFactory();
    scheduler.setupEmailDispatcher(SMTP_ENV, factory);
    const summary = await scheduler.runDailySweep(new Date('2026-06-08'));
    expect(summary.emailEnabled).toBe(true);
    expect(state.dispatchCalls[0].opts.channels).toEqual([
      ReminderChannel.IN_APP,
      ReminderChannel.EMAIL,
    ]);
  });

  it('派送失敗記入 failures（含管道與原因），成功照計', async () => {
    const { scheduler } = makeService({
      stepCaseIds: ['c1'],
      perCase: {
        c1: {
          dispatched: [
            okResult('k1', ReminderChannel.IN_APP),
            failResult('k1e', ReminderChannel.EMAIL, 'recipient_email_missing'),
          ],
          due: [dueStub('k1'), dueStub('k1e')],
        },
      },
    });
    const summary = await scheduler.runDailySweep(new Date('2026-06-08'));
    expect(summary.sentCount).toBe(1);
    expect(summary.failedCount).toBe(1);
    expect(summary.failures[0]).toEqual({
      caseId: 'c1',
      dedupKey: 'k1e',
      channel: ReminderChannel.EMAIL,
      error: 'recipient_email_missing',
    });
  });

  it('單一案件整體丟錯 → 記 failures、不中斷其餘案件', async () => {
    const { scheduler, state } = makeService({
      stepCaseIds: ['c1', 'c2'],
      perCase: {
        c1: new Error('case_read_failed'),
        c2: { dispatched: [okResult('k2', ReminderChannel.IN_APP)], due: [dueStub('k2')] },
      },
    });
    const summary = await scheduler.runDailySweep(new Date('2026-06-08'));
    expect(summary.casesScanned).toBe(2);
    expect(summary.sentCount).toBe(1);
    expect(summary.failedCount).toBe(1);
    expect(summary.failures[0].caseId).toBe('c1');
    expect(summary.failures[0].error).toBe('case_read_failed');
    expect(state.dispatchCalls.map((c) => c.caseId)).toEqual(['c1', 'c2']);
  });
});
