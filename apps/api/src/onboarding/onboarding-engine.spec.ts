import { FlowType, SaleMode, SubmissionStatus } from '@prisma/client';
import {
  AUTH_DELEGATION_FORM_CODE,
  DEFAULT_ONBOARDING_CHECKPOINTS,
  DEFAULT_ONBOARDING_STEPS,
  ENG_HANDOFF_FORM_CODE,
  KICKOFF_MINUTES_FORM_CODE,
  ONBOARDING_HANDOFF_FORM_CODE,
  ONBOARDING_PLAN_FORM_CODE,
  ONBOARDING_SIGNABLE_FORM_CODES,
  OnboardingEngineError,
  OnboardingStep,
  STAFF_ROSTER_FORM_CODE,
  buildSchedule,
  deserializeEnvironmentBlueprint,
  dueReminders,
  intakeFromSalesHandoff,
  isAuthDelegationSigned,
  planEngineeringHandoff,
  serializeEnvironmentBlueprint,
  unmetForms,
  type EngineeringHandoffInput,
  type FormStatusLike,
  type OnboardingIntake,
} from './onboarding-engine';

/** 便利：建一筆表單狀態。 */
const fs = (formCode: string, status: SubmissionStatus): FormStatusLike => ({ formCode, status });

/** 便利：合法的 intake。 */
const sampleIntake = (): OnboardingIntake => ({
  finalQuoteRefId: 'quote-1',
  customRequirementRefId: 'custom-1',
  carriedDocRefIds: ['quote-1', 'custom-1'],
});

/** 便利：齊備的 COLLECT_DATA 表單狀態（人員資料表 SUBMITTED + 委任權限表 APPROVED）。 */
const collectSatisfied = (): FormStatusLike[] => [
  fs(STAFF_ROSTER_FORM_CODE, SubmissionStatus.SUBMITTED),
  fs(AUTH_DELEGATION_FORM_CODE, SubmissionStatus.APPROVED),
];

describe('onboarding-engine 預定義骨架', () => {
  it('內建 5 個步驟、order 連續且唯一', () => {
    expect(DEFAULT_ONBOARDING_STEPS).toHaveLength(5);
    const orders = DEFAULT_ONBOARDING_STEPS.map((s) => s.order);
    expect(orders).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(orders).size).toBe(5);
  });

  it('COLLECT_DATA 步驟含人員資料表與委任權限表', () => {
    const step = DEFAULT_ONBOARDING_STEPS.find((s) => s.step === OnboardingStep.COLLECT_DATA)!;
    expect(step.formCodes).toContain(STAFF_ROSTER_FORM_CODE);
    expect(step.formCodes).toContain(AUTH_DELEGATION_FORM_CODE);
  });

  it('委任權限表被列為簽核表單', () => {
    expect(ONBOARDING_SIGNABLE_FORM_CODES.has(AUTH_DELEGATION_FORM_CODE)).toBe(true);
  });

  it('內建骨架為凍結（不可變）', () => {
    expect(Object.isFrozen(DEFAULT_ONBOARDING_STEPS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_ONBOARDING_CHECKPOINTS)).toBe(true);
  });
});

describe('intakeFromSalesHandoff（接收銷售移交 §5.2 步驟1）', () => {
  it('由銷售移交藍圖萃取產出引用並去重', () => {
    const intake = intakeFromSalesHandoff({
      finalQuote: { refId: 'quote-1' },
      customRequirement: { refId: 'custom-1' },
      carriedDocRefIds: ['quote-1', 'custom-1'],
    });
    expect(intake.finalQuoteRefId).toBe('quote-1');
    expect(intake.customRequirementRefId).toBe('custom-1');
    expect(intake.carriedDocRefIds.sort()).toEqual(['custom-1', 'quote-1']);
  });

  it('無客製需求時 customRequirementRefId 為 null', () => {
    const intake = intakeFromSalesHandoff({
      finalQuote: { refId: 'quote-9' },
      customRequirement: null,
      carriedDocRefIds: ['quote-9'],
    });
    expect(intake.customRequirementRefId).toBeNull();
    expect(intake.carriedDocRefIds).toEqual(['quote-9']);
  });

  it('無定版報價單引用 → no_final_quote_in_intake', () => {
    expect(() =>
      intakeFromSalesHandoff({ finalQuote: null, carriedDocRefIds: [] }),
    ).toThrow(OnboardingEngineError);
    try {
      intakeFromSalesHandoff({ finalQuote: { refId: '' }, carriedDocRefIds: [] });
    } catch (e) {
      expect((e as OnboardingEngineError).code).toBe('no_final_quote_in_intake');
    }
  });

  it('非物件輸入 → intake_invalid', () => {
    try {
      // @ts-expect-error 測試非法輸入
      intakeFromSalesHandoff(null);
    } catch (e) {
      expect((e as OnboardingEngineError).code).toBe('intake_invalid');
    }
  });
});

describe('buildSchedule（預定義時間點 §5.1）', () => {
  const anchor = new Date('2026-06-01T00:00:00.000Z');

  it('依錨點 + offset 算出絕對日期並排序', () => {
    const sched = buildSchedule(anchor);
    expect(sched).toHaveLength(DEFAULT_ONBOARDING_CHECKPOINTS.length);
    expect(sched[0].step).toBe(OnboardingStep.PLAN);
    expect(sched[0].plannedDate.toISOString()).toBe('2026-06-04T00:00:00.000Z');
    for (let i = 1; i < sched.length; i++) {
      expect(sched[i].plannedDate.getTime()).toBeGreaterThanOrEqual(
        sched[i - 1].plannedDate.getTime(),
      );
    }
  });

  it('isExcluded 會將計畫日遞延至下一個非排除日（§5.3 連假遞延）', () => {
    const excluded = (d: Date) => d.toISOString().startsWith('2026-06-04');
    const sched = buildSchedule(anchor, DEFAULT_ONBOARDING_CHECKPOINTS, excluded);
    const plan = sched.find((s) => s.step === OnboardingStep.PLAN)!;
    expect(plan.plannedDate.toISOString()).toBe('2026-06-05T00:00:00.000Z');
  });

  it('錨點非法 → plan_anchor_required', () => {
    try {
      buildSchedule(new Date('not-a-date'));
    } catch (e) {
      expect((e as OnboardingEngineError).code).toBe('plan_anchor_required');
    }
  });

  it('offset 為負 → checkpoint_offset_invalid', () => {
    try {
      buildSchedule(anchor, [
        { step: OnboardingStep.PLAN, label: 'x', offsetDays: -1, formCodes: [] },
      ]);
    } catch (e) {
      expect((e as OnboardingEngineError).code).toBe('checkpoint_offset_invalid');
    }
  });
});

describe('dueReminders（主動提醒 §5.3）', () => {
  const anchor = new Date('2026-06-01T00:00:00.000Z');
  const sched = buildSchedule(anchor); // 6/4, 6/8, 6/15, 6/22

  it('涵蓋逾期與 lookahead 內到期者', () => {
    const now = new Date('2026-06-06T00:00:00.000Z');
    const items = dueReminders(sched, now, 3);
    const steps = items.map((i) => i.step);
    expect(steps).toContain(OnboardingStep.PLAN);
    expect(steps).toContain(OnboardingStep.KICKOFF);
    expect(steps).not.toContain(OnboardingStep.COLLECT_DATA);
  });

  it('標記逾期與剩餘天數', () => {
    const now = new Date('2026-06-06T00:00:00.000Z');
    const items = dueReminders(sched, now, 3);
    const plan = items.find((i) => i.step === OnboardingStep.PLAN)!;
    expect(plan.overdue).toBe(true);
    expect(plan.daysUntilDue).toBeLessThan(0);
  });

  it('已完成的步驟不再提醒', () => {
    const now = new Date('2026-06-06T00:00:00.000Z');
    const items = dueReminders(sched, now, 3, new Set([OnboardingStep.PLAN]));
    expect(items.map((i) => i.step)).not.toContain(OnboardingStep.PLAN);
  });
});

describe('unmetForms / 簽核把關（§5.2 步驟4、§5.3）', () => {
  it('一般表單 SUBMITTED 即齊備；簽核表單需 APPROVED', () => {
    const codes = [STAFF_ROSTER_FORM_CODE, AUTH_DELEGATION_FORM_CODE];
    const unmet1 = unmetForms(codes, [
      fs(STAFF_ROSTER_FORM_CODE, SubmissionStatus.SUBMITTED),
      fs(AUTH_DELEGATION_FORM_CODE, SubmissionStatus.SUBMITTED),
    ]);
    expect(unmet1).toEqual([AUTH_DELEGATION_FORM_CODE]);
    const unmet2 = unmetForms(codes, collectSatisfied());
    expect(unmet2).toEqual([]);
  });

  it('isAuthDelegationSigned 僅在 APPROVED 時為 true', () => {
    expect(isAuthDelegationSigned([fs(AUTH_DELEGATION_FORM_CODE, SubmissionStatus.SUBMITTED)])).toBe(
      false,
    );
    expect(isAuthDelegationSigned([fs(AUTH_DELEGATION_FORM_CODE, SubmissionStatus.APPROVED)])).toBe(
      true,
    );
  });
});

describe('planEngineeringHandoff（移交工程、建立環境建置藍圖 §5.2 步驟5）', () => {
  const base = (): EngineeringHandoffInput => ({
    intake: sampleIntake(),
    clientName: '宏達客戶',
    saleMode: SaleMode.SUBSCRIPTION,
    kickoffCompleted: true,
    submissions: collectSatisfied(),
  });

  it('條件齊備時回傳 ENVIRONMENT 藍圖並帶往產出', () => {
    const bp = planEngineeringHandoff(base());
    expect(bp.flowType).toBe(FlowType.ENVIRONMENT);
    expect(bp.clientName).toBe('宏達客戶');
    expect(bp.saleMode).toBe(SaleMode.SUBSCRIPTION);
    expect(bp.carriedDocRefIds.sort()).toEqual(['custom-1', 'quote-1']);
    expect(bp.title).toContain('宏達客戶');
  });

  it('extraDocRefIds 會併入並去重', () => {
    const bp = planEngineeringHandoff({
      ...base(),
      extraDocRefIds: ['kickoff-minutes-1', 'quote-1'],
    });
    expect(bp.carriedDocRefIds.sort()).toEqual(['custom-1', 'kickoff-minutes-1', 'quote-1']);
  });

  it('啟動會議未完成 → kickoff_incomplete', () => {
    try {
      planEngineeringHandoff({ ...base(), kickoffCompleted: false });
    } catch (e) {
      expect((e as OnboardingEngineError).code).toBe('kickoff_incomplete');
    }
  });

  it('僅缺委任權限表簽核 → auth_delegation_unsigned', () => {
    try {
      planEngineeringHandoff({
        ...base(),
        submissions: [
          fs(STAFF_ROSTER_FORM_CODE, SubmissionStatus.SUBMITTED),
          fs(AUTH_DELEGATION_FORM_CODE, SubmissionStatus.SUBMITTED),
        ],
      });
    } catch (e) {
      expect((e as OnboardingEngineError).code).toBe('auth_delegation_unsigned');
    }
  });

  it('其他必填表單也缺 → required_forms_incomplete', () => {
    try {
      planEngineeringHandoff({
        ...base(),
        submissions: [fs(AUTH_DELEGATION_FORM_CODE, SubmissionStatus.SUBMITTED)],
      });
    } catch (e) {
      expect((e as OnboardingEngineError).code).toBe('required_forms_incomplete');
    }
  });
});

describe('環境建置藍圖序列化', () => {
  const bp = {
    flowType: FlowType.ENVIRONMENT,
    title: '環境建置 - 客戶A',
    clientName: '客戶A',
    saleMode: SaleMode.PURCHASE,
    carriedDocRefIds: ['quote-1', 'custom-1'],
  };

  it('round-trip 還原一致', () => {
    const data = serializeEnvironmentBlueprint(bp);
    const restored = deserializeEnvironmentBlueprint(JSON.parse(JSON.stringify(data)));
    expect(restored).toEqual(bp);
    expect(ONBOARDING_HANDOFF_FORM_CODE).toBe('ONBOARDING_ENG_HANDOFF_BLUEPRINT');
  });

  it('saleMode 不合法時還原為 null', () => {
    const restored = deserializeEnvironmentBlueprint({
      ...serializeEnvironmentBlueprint(bp),
      saleMode: 'BOGUS',
    });
    expect(restored.saleMode).toBeNull();
  });

  it('毀損資料（缺 title / 錯 flowType）→ handoff_corrupt', () => {
    try {
      deserializeEnvironmentBlueprint({ flowType: FlowType.SALES });
    } catch (e) {
      expect((e as OnboardingEngineError).code).toBe('handoff_corrupt');
    }
    try {
      deserializeEnvironmentBlueprint(null);
    } catch (e) {
      expect((e as OnboardingEngineError).code).toBe('handoff_corrupt');
    }
  });
});

describe('表單代碼常數穩定性', () => {
  it('代碼值不變', () => {
    expect(ONBOARDING_PLAN_FORM_CODE).toBe('ONBOARDING_PLAN');
    expect(KICKOFF_MINUTES_FORM_CODE).toBe('ONBOARDING_KICKOFF_MINUTES');
    expect(STAFF_ROSTER_FORM_CODE).toBe('ONBOARDING_STAFF_ROSTER');
    expect(AUTH_DELEGATION_FORM_CODE).toBe('ONBOARDING_AUTH_DELEGATION');
    expect(ENG_HANDOFF_FORM_CODE).toBe('ONBOARDING_ENG_HANDOFF');
  });
});
