import { FlowType, SaleMode, SubmissionStatus } from '@prisma/client';
import {
  DEFAULT_ENVIRONMENT_STEPS,
  ENV_ACCEPTANCE_FORM_CODE,
  ENV_BUILD_CHECKLIST_FORM_CODE,
  ENV_HANDOFF_FORM_CODE,
  ENV_HOST_PROCUREMENT_FORM_CODE,
  ENV_TENANT_RECORD_FORM_CODE,
  ENVIRONMENT_INTAKE_FORM_CODE,
  EnvironmentEngineError,
  EnvironmentStep,
  branchBuildFormCode,
  buildBranchSteps,
  deserializeEnvironmentIntake,
  evaluateHostReadiness,
  intakeFromOnboardingHandoff,
  planAcceptance,
  resolveBranch,
  serializeEnvironmentIntake,
  unmetForms,
  type EnvironmentCompletionInput,
  type EnvironmentHandoffLike,
  type EnvironmentIntake,
  type FormStatusLike,
} from './environment-engine';

/** 便利：建一筆表單狀態。 */
const fs = (formCode: string, status: SubmissionStatus): FormStatusLike => ({ formCode, status });

/** 便利：合法的導入移交藍圖（買斷）。 */
const purchaseHandoff = (): EnvironmentHandoffLike => ({
  flowType: FlowType.ENVIRONMENT,
  title: '環境建置 - 客戶A',
  clientName: '客戶A',
  saleMode: SaleMode.PURCHASE,
  carriedDocRefIds: ['quote-1', 'custom-1', 'quote-1'],
});

/** 便利：合法的導入移交藍圖（訂閱）。 */
const subscriptionHandoff = (): EnvironmentHandoffLike => ({
  flowType: FlowType.ENVIRONMENT,
  title: '環境建置 - 客戶B',
  clientName: '客戶B',
  saleMode: SaleMode.SUBSCRIPTION,
  carriedDocRefIds: ['quote-9'],
});

describe('environment-engine 預定義骨架', () => {
  it('內建 4 個步驟（含兩分支）', () => {
    expect(DEFAULT_ENVIRONMENT_STEPS).toHaveLength(4);
    const steps = DEFAULT_ENVIRONMENT_STEPS.map((s) => s.step);
    expect(steps).toContain(EnvironmentStep.RECEIVE_HANDOFF);
    expect(steps).toContain(EnvironmentStep.HOST_BUILD);
    expect(steps).toContain(EnvironmentStep.TENANT_PROVISION);
    expect(steps).toContain(EnvironmentStep.ACCEPTANCE);
  });

  it('內建骨架為凍結（不可變）', () => {
    expect(Object.isFrozen(DEFAULT_ENVIRONMENT_STEPS)).toBe(true);
  });
});

describe('resolveBranch / buildBranchSteps（依銷售模式分支 §6.1）', () => {
  it('買斷→HOST、訂閱→TENANT', () => {
    expect(resolveBranch(SaleMode.PURCHASE)).toBe('HOST');
    expect(resolveBranch(SaleMode.SUBSCRIPTION)).toBe('TENANT');
  });

  it('缺銷售模式→sale_mode_required', () => {
    try {
      resolveBranch(null);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EnvironmentEngineError).code).toBe('sale_mode_required');
    }
  });

  it('買斷分支含主機建置、不含租戶開立；order 連續', () => {
    const steps = buildBranchSteps(SaleMode.PURCHASE);
    const kinds = steps.map((s) => s.step);
    expect(kinds).toContain(EnvironmentStep.HOST_BUILD);
    expect(kinds).not.toContain(EnvironmentStep.TENANT_PROVISION);
    expect(steps.map((s) => s.order)).toEqual([1, 2, 3]);
    expect(steps[steps.length - 1].step).toBe(EnvironmentStep.ACCEPTANCE);
  });

  it('訂閱分支含租戶開立、不含主機建置', () => {
    const steps = buildBranchSteps(SaleMode.SUBSCRIPTION);
    const kinds = steps.map((s) => s.step);
    expect(kinds).toContain(EnvironmentStep.TENANT_PROVISION);
    expect(kinds).not.toContain(EnvironmentStep.HOST_BUILD);
  });

  it('branchBuildFormCode 對應正確表單', () => {
    expect(branchBuildFormCode('HOST')).toBe(ENV_BUILD_CHECKLIST_FORM_CODE);
    expect(branchBuildFormCode('TENANT')).toBe(ENV_TENANT_RECORD_FORM_CODE);
  });
});

describe('intakeFromOnboardingHandoff（接收導入移交 §6.2 步驟1）', () => {
  it('由移交藍圖萃取並去重、帶分支', () => {
    const intake = intakeFromOnboardingHandoff(purchaseHandoff());
    expect(intake.clientName).toBe('客戶A');
    expect(intake.saleMode).toBe(SaleMode.PURCHASE);
    expect(intake.branch).toBe('HOST');
    expect(intake.carriedDocRefIds.sort()).toEqual(['custom-1', 'quote-1']);
  });

  it('訂閱移交→TENANT 分支', () => {
    const intake = intakeFromOnboardingHandoff(subscriptionHandoff());
    expect(intake.branch).toBe('TENANT');
    expect(intake.carriedDocRefIds).toEqual(['quote-9']);
  });

  it('缺 clientName→intake_invalid', () => {
    try {
      intakeFromOnboardingHandoff({ saleMode: SaleMode.PURCHASE, carriedDocRefIds: [] });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EnvironmentEngineError).code).toBe('intake_invalid');
    }
  });

  it('缺銷售模式→sale_mode_required', () => {
    try {
      intakeFromOnboardingHandoff({ clientName: '客戶X', carriedDocRefIds: [] });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EnvironmentEngineError).code).toBe('sale_mode_required');
    }
  });

  it('非物件→intake_invalid', () => {
    try {
      // @ts-expect-error 測試非法輸入
      intakeFromOnboardingHandoff(null);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EnvironmentEngineError).code).toBe('intake_invalid');
    }
  });
});

describe('evaluateHostReadiness（主機採購等待狀態 §6.3）', () => {
  it('買斷未採購→等待、不可建置', () => {
    const r = evaluateHostReadiness(SaleMode.PURCHASE, false);
    expect(r.branch).toBe('HOST');
    expect(r.waitingForHost).toBe(true);
    expect(r.canStartBuild).toBe(false);
  });

  it('買斷已採購→不等待、可建置', () => {
    const r = evaluateHostReadiness(SaleMode.PURCHASE, true);
    expect(r.waitingForHost).toBe(false);
    expect(r.canStartBuild).toBe(true);
  });

  it('訂閱→恆不等待、可建置（開立租戶）', () => {
    const r = evaluateHostReadiness(SaleMode.SUBSCRIPTION, false);
    expect(r.branch).toBe('TENANT');
    expect(r.waitingForHost).toBe(false);
    expect(r.canStartBuild).toBe(true);
  });
});

describe('unmetForms（齊備把關）', () => {
  it('SUBMITTED 或 APPROVED 即齊備', () => {
    expect(
      unmetForms([ENV_ACCEPTANCE_FORM_CODE], [fs(ENV_ACCEPTANCE_FORM_CODE, SubmissionStatus.SUBMITTED)]),
    ).toEqual([]);
    expect(unmetForms([ENV_ACCEPTANCE_FORM_CODE], [])).toEqual([ENV_ACCEPTANCE_FORM_CODE]);
  });
});

describe('planAcceptance（環境驗收完成 §6.2 步驟3、§6.3）', () => {
  const subscriptionReady = (): EnvironmentCompletionInput => ({
    saleMode: SaleMode.SUBSCRIPTION,
    submissions: [
      fs(ENV_TENANT_RECORD_FORM_CODE, SubmissionStatus.SUBMITTED),
      fs(ENV_ACCEPTANCE_FORM_CODE, SubmissionStatus.APPROVED),
    ],
  });

  const purchaseReady = (): EnvironmentCompletionInput => ({
    saleMode: SaleMode.PURCHASE,
    hostProcured: true,
    submissions: [
      fs(ENV_BUILD_CHECKLIST_FORM_CODE, SubmissionStatus.SUBMITTED),
      fs(ENV_ACCEPTANCE_FORM_CODE, SubmissionStatus.SUBMITTED),
    ],
  });

  it('訂閱齊備→驗收通過', () => {
    const r = planAcceptance(subscriptionReady());
    expect(r.accepted).toBe(true);
    expect(r.branch).toBe('TENANT');
    expect(r.buildFormCode).toBe(ENV_TENANT_RECORD_FORM_CODE);
  });

  it('買斷已採購+齊備→驗收通過', () => {
    const r = planAcceptance(purchaseReady());
    expect(r.branch).toBe('HOST');
    expect(r.buildFormCode).toBe(ENV_BUILD_CHECKLIST_FORM_CODE);
  });

  it('買斷未採購主機→host_purchase_pending', () => {
    try {
      planAcceptance({ ...purchaseReady(), hostProcured: false });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EnvironmentEngineError).code).toBe('host_purchase_pending');
    }
  });

  it('分支建置表單未齊→branch_forms_incomplete', () => {
    try {
      planAcceptance({
        saleMode: SaleMode.SUBSCRIPTION,
        submissions: [fs(ENV_ACCEPTANCE_FORM_CODE, SubmissionStatus.SUBMITTED)],
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EnvironmentEngineError).code).toBe('branch_forms_incomplete');
    }
  });

  it('驗收表未完成→acceptance_incomplete', () => {
    try {
      planAcceptance({
        saleMode: SaleMode.SUBSCRIPTION,
        submissions: [fs(ENV_TENANT_RECORD_FORM_CODE, SubmissionStatus.SUBMITTED)],
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EnvironmentEngineError).code).toBe('acceptance_incomplete');
    }
  });
});

describe('環境建置接收序列化', () => {
  const intake: EnvironmentIntake = {
    clientName: '客戶A',
    saleMode: SaleMode.PURCHASE,
    branch: 'HOST',
    carriedDocRefIds: ['quote-1', 'custom-1'],
  };

  it('round-trip 還原一致', () => {
    const data = serializeEnvironmentIntake(intake);
    const restored = deserializeEnvironmentIntake(JSON.parse(JSON.stringify(data)));
    expect(restored).toEqual(intake);
  });

  it('saleMode 不合法時還原為 null', () => {
    const restored = deserializeEnvironmentIntake({
      ...serializeEnvironmentIntake(intake),
      saleMode: 'BOGUS',
    });
    expect(restored.saleMode).toBeNull();
  });

  it('毀損資料（缺 clientName / 錯 branch）→intake_corrupt', () => {
    try {
      deserializeEnvironmentIntake({ branch: 'HOST', carriedDocRefIds: [] });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EnvironmentEngineError).code).toBe('intake_corrupt');
    }
    try {
      deserializeEnvironmentIntake({ clientName: '客戶A', branch: 'WRONG' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EnvironmentEngineError).code).toBe('intake_corrupt');
    }
    try {
      deserializeEnvironmentIntake(null);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EnvironmentEngineError).code).toBe('intake_corrupt');
    }
  });
});

describe('表單代碼常數穩定性', () => {
  it('代碼值不變', () => {
    expect(ENV_HANDOFF_FORM_CODE).toBe('ENVIRONMENT_HANDOFF');
    expect(ENV_BUILD_CHECKLIST_FORM_CODE).toBe('ENVIRONMENT_BUILD_CHECKLIST');
    expect(ENV_TENANT_RECORD_FORM_CODE).toBe('ENVIRONMENT_TENANT_RECORD');
    expect(ENV_ACCEPTANCE_FORM_CODE).toBe('ENVIRONMENT_ACCEPTANCE');
    expect(ENV_HOST_PROCUREMENT_FORM_CODE).toBe('ENVIRONMENT_HOST_PROCUREMENT');
    expect(ENVIRONMENT_INTAKE_FORM_CODE).toBe('ENVIRONMENT_INTAKE');
  });
});
