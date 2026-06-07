import { OnboardingService } from './onboarding.service';
import { EnvironmentService } from '../environment/environment.service';
import { CalendarService } from '../calendar/calendar.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalesService } from '../sales/sales.service';
import {
  DEFAULT_ONBOARDING_CHECKPOINTS,
  OnboardingCheckpointDef,
  OnboardingStep,
} from './onboarding-engine';
import { EnvironmentStep } from '../environment/environment-engine';

/**
 * 7.1（#31）：驗證 onboarding / environment 服務層「實際注入」CalendarService.buildIsExcluded()
 * 至 buildSchedule——計畫日落假日（DB Holiday 驅動）時自動遞延，取代先前的 identity 預設。
 *
 * CalendarService 以 stub 取代（DB 行為由 calendar 模組自身測試覆蓋；9.1 將補真實 DB 整合測試），
 * 此處聚焦服務層接線：buildIsExcluded 之 opts 透傳、回傳 predicate 確實被 buildSchedule 套用。
 */

/** 假日 stub：2026-06-04（四）為 DB 假日；其餘皆工作日。 */
const isJune4 = (d: Date) => d.toISOString().startsWith('2026-06-04');

/** 建立可記錄呼叫參數的 CalendarService stub。 */
function calendarStub() {
  const calls: Array<{ projectId?: string; custom?: unknown }> = [];
  const stub = {
    buildIsExcluded: async (opts: { projectId?: string; custom?: unknown } = {}) => {
      calls.push(opts);
      return isJune4;
    },
  };
  return { stub: stub as unknown as CalendarService, calls };
}

const prismaStub = {} as unknown as PrismaService;
const salesStub = {} as unknown as SalesService;

const anchor = new Date('2026-06-01T00:00:00.000Z');

describe('OnboardingService.buildCaseSchedule（7.1 DB 假日注入）', () => {
  it('預設使用內建時間點骨架，計畫日落假日時遞延至下一非排除日', async () => {
    const { stub } = calendarStub();
    const svc = new OnboardingService(prismaStub, salesStub, stub);
    const sched = await svc.buildCaseSchedule(anchor);
    expect(sched).toHaveLength(DEFAULT_ONBOARDING_CHECKPOINTS.length);
    const plan = sched.find((s) => s.step === OnboardingStep.PLAN)!;
    // 6/1 + 3 = 6/4（假日）→ 遞延 6/5
    expect(plan.plannedDate.toISOString()).toBe('2026-06-05T00:00:00.000Z');
  });

  it('未落假日的時間點不受影響', async () => {
    const { stub } = calendarStub();
    const svc = new OnboardingService(prismaStub, salesStub, stub);
    const sched = await svc.buildCaseSchedule(anchor);
    const kickoff = sched.find((s) => s.step === OnboardingStep.KICKOFF)!;
    expect(kickoff.plannedDate.toISOString()).toBe('2026-06-08T00:00:00.000Z');
  });

  it('projectId / custom 透傳給 CalendarService.buildIsExcluded（專案排除日 §10.5）', async () => {
    const { stub, calls } = calendarStub();
    const svc = new OnboardingService(prismaStub, salesStub, stub);
    const custom = { holidays: ['2026-06-10'] };
    await svc.buildCaseSchedule(anchor, { projectId: 'prj-1', custom });
    expect(calls).toHaveLength(1);
    expect(calls[0].projectId).toBe('prj-1');
    expect(calls[0].custom).toBe(custom);
  });
});

describe('OnboardingService.getDueReminders（§5.3，遞延後提醒同步）', () => {
  it('涵蓋逾期與 lookahead 內到期者；已完成步驟不提醒', async () => {
    const { stub } = calendarStub();
    const svc = new OnboardingService(prismaStub, salesStub, stub);
    const now = new Date('2026-06-06T00:00:00.000Z');
    const items = await svc.getDueReminders(anchor, { now, lookaheadDays: 3 });
    const steps = items.map((i) => i.step);
    expect(steps).toContain(OnboardingStep.PLAN); // 遞延後 6/5，已逾期
    expect(steps).toContain(OnboardingStep.KICKOFF); // 6/8，3 天內
    expect(steps).not.toContain(OnboardingStep.COLLECT_DATA);
    const plan = items.find((i) => i.step === OnboardingStep.PLAN)!;
    expect(plan.overdue).toBe(true);

    const done = await svc.getDueReminders(anchor, {
      now,
      lookaheadDays: 3,
      completedSteps: new Set([OnboardingStep.PLAN]),
    });
    expect(done.map((i) => i.step)).not.toContain(OnboardingStep.PLAN);
  });
});

describe('EnvironmentService.buildEnvironmentSchedule（7.1 DB 假日注入）', () => {
  const envCheckpoints: readonly OnboardingCheckpointDef<EnvironmentStep>[] = [
    { step: EnvironmentStep.RECEIVE_HANDOFF, label: '接收移交', offsetDays: 0, formCodes: [] },
    { step: EnvironmentStep.HOST_BUILD, label: '主機建置', offsetDays: 3, formCodes: [] },
  ];

  it('計畫日落假日時遞延；未落假日者不變', async () => {
    const { stub } = calendarStub();
    const svc = new EnvironmentService(
      prismaStub,
      {} as unknown as OnboardingService,
      stub,
    );
    const sched = await svc.buildEnvironmentSchedule(anchor, envCheckpoints);
    const receive = sched.find((s) => s.step === EnvironmentStep.RECEIVE_HANDOFF)!;
    const build = sched.find((s) => s.step === EnvironmentStep.HOST_BUILD)!;
    expect(receive.plannedDate.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    // 6/1 + 3 = 6/4（假日）→ 遞延 6/5
    expect(build.plannedDate.toISOString()).toBe('2026-06-05T00:00:00.000Z');
  });

  it('projectId 透傳給 buildIsExcluded', async () => {
    const { stub, calls } = calendarStub();
    const svc = new EnvironmentService(
      prismaStub,
      {} as unknown as OnboardingService,
      stub,
    );
    await svc.buildEnvironmentSchedule(anchor, envCheckpoints, { projectId: 'prj-9' });
    expect(calls[0].projectId).toBe('prj-9');
  });
});
