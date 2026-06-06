import { FlowType, SubmissionStatus } from '@prisma/client';
import {
  CHANGE_REQUEST_FORM_CODE,
  CUSTOMIZATION_FLOW_TYPE,
  CUSTOMIZATION_REQUEST_FORM_CODE,
  CUSTOMIZATION_SIGNABLE_FORM_CODES,
  CustomizationAction,
  CustomizationEngineError,
  CustomizationState,
  CustomizationStep,
  DEFAULT_CUSTOMIZATION_STEPS,
  DEV_RECORD_FORM_CODE,
  DEV_TASK_FORM_CODE,
  PROD_DEPLOY_FORM_CODE,
  RETEST_REPORT_FORM_CODE,
  ROLE_ENGINEER,
  ROLE_ENG_LEAD,
  TEST_DEPLOY_FORM_CODE,
  TEST_DOC_FORM_CODE,
  applyRetestResult,
  buildChangeRequest,
  canTransition,
  deserializeChangeRequest,
  isReturnAction,
  nextState,
  planAssignEngineer,
  planAssignLead,
  planProductionDeployment,
  planSubmitForRetest,
  planTestDeployment,
  serializeChangeRequest,
  unmetForms,
  type FormStatusLike,
} from './customization-engine';

/** 便利：建一筆表單狀態。 */
const fs = (formCode: string, status: SubmissionStatus): FormStatusLike => ({ formCode, status });

/** 便利：開發階段已備齊（開發紀錄 + 測試文件）。 */
const devReady = (): FormStatusLike[] => [
  fs(DEV_RECORD_FORM_CODE, SubmissionStatus.SUBMITTED),
  fs(TEST_DOC_FORM_CODE, SubmissionStatus.SUBMITTED),
];

describe('customization-engine 常數與骨架', () => {
  it('flowType 對齊 schema CUSTOMIZATION', () => {
    expect(CUSTOMIZATION_FLOW_TYPE).toBe(FlowType.CUSTOMIZATION);
  });

  it('需求變更單表單代碼與接收容器代碼一致', () => {
    expect(CUSTOMIZATION_REQUEST_FORM_CODE).toBe(CHANGE_REQUEST_FORM_CODE);
  });

  it('預設簽核集合為空（§12-4 待釐清，保留介面）', () => {
    expect(CUSTOMIZATION_SIGNABLE_FORM_CODES.size).toBe(0);
  });

  it('DEFAULT_CUSTOMIZATION_STEPS 為 8 步、order 連續 1..8', () => {
    expect(DEFAULT_CUSTOMIZATION_STEPS).toHaveLength(8);
    expect(DEFAULT_CUSTOMIZATION_STEPS.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(DEFAULT_CUSTOMIZATION_STEPS[0].step).toBe(CustomizationStep.RAISE_REQUEST);
    expect(DEFAULT_CUSTOMIZATION_STEPS[7].step).toBe(CustomizationStep.DEPLOY_PROD);
  });

  it('預設骨架為凍結（不可變）', () => {
    expect(Object.isFrozen(DEFAULT_CUSTOMIZATION_STEPS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CUSTOMIZATION_STEPS[0])).toBe(true);
    expect(() => {
      (DEFAULT_CUSTOMIZATION_STEPS[0] as { name: string }).name = 'x';
    }).toThrow();
  });

  it('指派步驟的負責角色提示正確（顧問指派 lead、lead 指派 engineer）', () => {
    const assignLead = DEFAULT_CUSTOMIZATION_STEPS.find(
      (s) => s.step === CustomizationStep.ASSIGN_LEAD,
    );
    const assignEng = DEFAULT_CUSTOMIZATION_STEPS.find(
      (s) => s.step === CustomizationStep.ASSIGN_ENGINEER,
    );
    expect(assignLead?.responsibleHint).toBe('CONSULTANT');
    expect(assignEng?.responsibleHint).toBe('ENG_LEAD');
    expect(assignEng?.formCodes).toContain(DEV_TASK_FORM_CODE);
  });
});

describe('狀態機 nextState / canTransition', () => {
  it('完整正常路徑（無退回）：DRAFT→...→COMPLETED', () => {
    let s = CustomizationState.DRAFT;
    s = nextState(s, CustomizationAction.SUBMIT_REQUEST);
    expect(s).toBe(CustomizationState.PENDING_LEAD_ASSIGN);
    s = nextState(s, CustomizationAction.ASSIGN_LEAD);
    expect(s).toBe(CustomizationState.PENDING_ENGINEER_ASSIGN);
    s = nextState(s, CustomizationAction.ASSIGN_ENGINEER);
    expect(s).toBe(CustomizationState.IN_DEVELOPMENT);
    s = nextState(s, CustomizationAction.SUBMIT_FOR_RETEST);
    expect(s).toBe(CustomizationState.IN_RETEST);
    s = nextState(s, CustomizationAction.RETEST_PASS);
    expect(s).toBe(CustomizationState.DEPLOYING_TEST);
    s = nextState(s, CustomizationAction.CONFIRM_TEST_DEPLOY);
    expect(s).toBe(CustomizationState.DEPLOYING_PROD);
    s = nextState(s, CustomizationAction.CONFIRM_PROD_DEPLOY);
    expect(s).toBe(CustomizationState.COMPLETED);
  });

  it('複測不通過退回開發（§7.3 循環）', () => {
    expect(nextState(CustomizationState.IN_RETEST, CustomizationAction.RETEST_FAIL)).toBe(
      CustomizationState.IN_DEVELOPMENT,
    );
  });

  it('canTransition 對合法 / 非法動作正確', () => {
    expect(canTransition(CustomizationState.DRAFT, CustomizationAction.SUBMIT_REQUEST)).toBe(true);
    expect(canTransition(CustomizationState.DRAFT, CustomizationAction.RETEST_PASS)).toBe(false);
    expect(
      canTransition(CustomizationState.COMPLETED, CustomizationAction.CONFIRM_PROD_DEPLOY),
    ).toBe(false);
  });

  it('非法轉移拋 invalid_transition', () => {
    expect(() => nextState(CustomizationState.DRAFT, CustomizationAction.ASSIGN_LEAD)).toThrow(
      CustomizationEngineError,
    );
    try {
      nextState(CustomizationState.COMPLETED, CustomizationAction.SUBMIT_REQUEST);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as CustomizationEngineError).code).toBe('invalid_transition');
    }
  });

  it('不能跳過指派鏈直接開發', () => {
    expect(() =>
      nextState(CustomizationState.PENDING_LEAD_ASSIGN, CustomizationAction.ASSIGN_ENGINEER),
    ).toThrow(CustomizationEngineError);
  });

  it('COMPLETED 為終態（無任何出邊）', () => {
    for (const a of Object.values(CustomizationAction)) {
      expect(canTransition(CustomizationState.COMPLETED, a)).toBe(false);
    }
  });

  it('isReturnAction 僅對 RETEST_FAIL 為真', () => {
    expect(isReturnAction(CustomizationAction.RETEST_FAIL)).toBe(true);
    expect(isReturnAction(CustomizationAction.RETEST_PASS)).toBe(false);
    expect(isReturnAction(CustomizationAction.ASSIGN_LEAD)).toBe(false);
  });
});

describe('指派鏈把關 planAssignLead / planAssignEngineer', () => {
  it('指派工程主管：期望角色 ENG_LEAD，角色相符', () => {
    const r = planAssignLead({ assigneeId: 'u-lead', assigneeRole: ROLE_ENG_LEAD });
    expect(r.step).toBe(CustomizationStep.ASSIGN_LEAD);
    expect(r.assigneeId).toBe('u-lead');
    expect(r.expectedRole).toBe(ROLE_ENG_LEAD);
    expect(r.roleMatches).toBe(true);
  });

  it('指派工程師：期望角色 ENGINEER，角色不符回報 false（不強制）', () => {
    const r = planAssignEngineer({ assigneeId: 'u-x', assigneeRole: 'SALES' });
    expect(r.expectedRole).toBe(ROLE_ENGINEER);
    expect(r.roleMatches).toBe(false);
  });

  it('未提供角色時 roleMatches=null（未驗證）', () => {
    const r = planAssignEngineer({ assigneeId: 'u-eng' });
    expect(r.roleMatches).toBeNull();
  });

  it('缺 assigneeId 拋 assignee_required', () => {
    try {
      planAssignLead({ assigneeId: '   ' });
      throw new Error('should throw');
    } catch (e) {
      expect((e as CustomizationEngineError).code).toBe('assignee_required');
    }
  });
});

describe('表單齊備 unmetForms', () => {
  it('SUBMITTED 或 APPROVED 視為齊備', () => {
    expect(unmetForms([DEV_RECORD_FORM_CODE], [fs(DEV_RECORD_FORM_CODE, SubmissionStatus.SUBMITTED)])).toEqual([]);
    expect(unmetForms([DEV_RECORD_FORM_CODE], [fs(DEV_RECORD_FORM_CODE, SubmissionStatus.APPROVED)])).toEqual([]);
  });

  it('DRAFT / REJECTED / 缺漏視為未齊備', () => {
    expect(unmetForms([DEV_RECORD_FORM_CODE], [fs(DEV_RECORD_FORM_CODE, SubmissionStatus.DRAFT)])).toEqual([DEV_RECORD_FORM_CODE]);
    expect(unmetForms([DEV_RECORD_FORM_CODE], [fs(DEV_RECORD_FORM_CODE, SubmissionStatus.REJECTED)])).toEqual([DEV_RECORD_FORM_CODE]);
    expect(unmetForms([DEV_RECORD_FORM_CODE], [])).toEqual([DEV_RECORD_FORM_CODE]);
  });

  it('簽核表單需 APPROVED 才齊備', () => {
    const signable = new Set([RETEST_REPORT_FORM_CODE]);
    expect(
      unmetForms([RETEST_REPORT_FORM_CODE], [fs(RETEST_REPORT_FORM_CODE, SubmissionStatus.SUBMITTED)], signable),
    ).toEqual([RETEST_REPORT_FORM_CODE]);
    expect(
      unmetForms([RETEST_REPORT_FORM_CODE], [fs(RETEST_REPORT_FORM_CODE, SubmissionStatus.APPROVED)], signable),
    ).toEqual([]);
  });
});

describe('送交複測把關 planSubmitForRetest（§7.2 步驟4/5）', () => {
  it('開發紀錄 + 測試文件齊備才可送複測', () => {
    const r = planSubmitForRetest(devReady());
    expect(r.ready).toBe(true);
    expect(r.requiredForms).toEqual([DEV_RECORD_FORM_CODE, TEST_DOC_FORM_CODE]);
  });

  it('缺測試文件拋 forms_incomplete', () => {
    try {
      planSubmitForRetest([fs(DEV_RECORD_FORM_CODE, SubmissionStatus.SUBMITTED)]);
      throw new Error('should throw');
    } catch (e) {
      expect((e as CustomizationEngineError).code).toBe('forms_incomplete');
    }
  });
});

describe('複測退回循環 applyRetestResult（§7.3）', () => {
  it('通過：進入 DEPLOYING_TEST，不退回', () => {
    const r = applyRetestResult(CustomizationState.IN_RETEST, { passed: true });
    expect(r.passed).toBe(true);
    expect(r.nextState).toBe(CustomizationState.DEPLOYING_TEST);
    expect(r.returned).toBe(false);
    expect(r.returnCount).toBe(0);
  });

  it('不通過：退回 IN_DEVELOPMENT，退回次數 +1', () => {
    const r = applyRetestResult(CustomizationState.IN_RETEST, { passed: false, priorReturnCount: 1 });
    expect(r.passed).toBe(false);
    expect(r.nextState).toBe(CustomizationState.IN_DEVELOPMENT);
    expect(r.returned).toBe(true);
    expect(r.returnCount).toBe(2);
  });

  it('通過時退回次數沿用 prior（不歸零）', () => {
    const r = applyRetestResult(CustomizationState.IN_RETEST, { passed: true, priorReturnCount: 3 });
    expect(r.returnCount).toBe(3);
  });

  it('非 IN_RETEST 狀態套用拋 invalid_transition', () => {
    try {
      applyRetestResult(CustomizationState.IN_DEVELOPMENT, { passed: true });
      throw new Error('should throw');
    } catch (e) {
      expect((e as CustomizationEngineError).code).toBe('invalid_transition');
    }
  });

  it('多輪退回後最終通過（循環收斂）', () => {
    let count = 0;
    let r = applyRetestResult(CustomizationState.IN_RETEST, { passed: false, priorReturnCount: count });
    count = r.returnCount; // 1
    r = applyRetestResult(CustomizationState.IN_RETEST, { passed: false, priorReturnCount: count });
    count = r.returnCount; // 2
    const pass = applyRetestResult(CustomizationState.IN_RETEST, { passed: true, priorReturnCount: count });
    expect(pass.returnCount).toBe(2);
    expect(pass.nextState).toBe(CustomizationState.DEPLOYING_TEST);
  });
});

describe('兩道關卡 planTestDeployment / planProductionDeployment（§7.2 步驟7/8、§7.3）', () => {
  it('測試區關卡：DEPLOYING_TEST + 測試區紀錄齊備才可確認', () => {
    const r = planTestDeployment(CustomizationState.DEPLOYING_TEST, [
      fs(TEST_DEPLOY_FORM_CODE, SubmissionStatus.SUBMITTED),
    ]);
    expect(r.gate).toBe('TEST');
    expect(r.recordFormCode).toBe(TEST_DEPLOY_FORM_CODE);
    expect(r.nextState).toBe(CustomizationState.DEPLOYING_PROD);
  });

  it('複測未通過（非 DEPLOYING_TEST）進測試區拋 retest_not_passed', () => {
    try {
      planTestDeployment(CustomizationState.IN_DEVELOPMENT, [
        fs(TEST_DEPLOY_FORM_CODE, SubmissionStatus.SUBMITTED),
      ]);
      throw new Error('should throw');
    } catch (e) {
      expect((e as CustomizationEngineError).code).toBe('retest_not_passed');
    }
  });

  it('測試區紀錄未齊備拋 forms_incomplete', () => {
    try {
      planTestDeployment(CustomizationState.DEPLOYING_TEST, []);
      throw new Error('should throw');
    } catch (e) {
      expect((e as CustomizationEngineError).code).toBe('forms_incomplete');
    }
  });

  it('正式區關卡：DEPLOYING_PROD + 正式區紀錄齊備才可上線', () => {
    const r = planProductionDeployment(CustomizationState.DEPLOYING_PROD, [
      fs(PROD_DEPLOY_FORM_CODE, SubmissionStatus.SUBMITTED),
    ]);
    expect(r.gate).toBe('PROD');
    expect(r.nextState).toBe(CustomizationState.COMPLETED);
  });

  it('測試區未確認（非 DEPLOYING_PROD）上正式區拋 test_deploy_pending', () => {
    try {
      planProductionDeployment(CustomizationState.DEPLOYING_TEST, [
        fs(PROD_DEPLOY_FORM_CODE, SubmissionStatus.SUBMITTED),
      ]);
      throw new Error('should throw');
    } catch (e) {
      expect((e as CustomizationEngineError).code).toBe('test_deploy_pending');
    }
  });

  it('正式區紀錄未齊備拋 forms_incomplete', () => {
    try {
      planProductionDeployment(CustomizationState.DEPLOYING_PROD, []);
      throw new Error('should throw');
    } catch (e) {
      expect((e as CustomizationEngineError).code).toBe('forms_incomplete');
    }
  });

  it('兩道關卡為獨立記錄（測試區與正式區不同表單代碼）', () => {
    expect(TEST_DEPLOY_FORM_CODE).not.toBe(PROD_DEPLOY_FORM_CODE);
  });
});

describe('需求變更單 buildChangeRequest / 序列化', () => {
  it('合法輸入正規化，carriedDocRefIds 去重', () => {
    const r = buildChangeRequest({
      clientName: '客戶A',
      title: '新增報表',
      description: '加一張月結報表',
      raisedById: 'u-consultant',
      carriedDocRefIds: ['doc-1', 'doc-1', 'doc-2'],
    });
    expect(r.clientName).toBe('客戶A');
    expect(r.title).toBe('新增報表');
    expect(r.description).toBe('加一張月結報表');
    expect(r.carriedDocRefIds).toEqual(['doc-1', 'doc-2']);
  });

  it('缺 clientName 或 title 拋 request_invalid', () => {
    expect(() => buildChangeRequest({ clientName: '', title: 't' })).toThrow(CustomizationEngineError);
    try {
      buildChangeRequest({ clientName: 'c', title: '   ' });
      throw new Error('should throw');
    } catch (e) {
      expect((e as CustomizationEngineError).code).toBe('request_invalid');
    }
  });

  it('description 缺省為 null', () => {
    const r = buildChangeRequest({ clientName: 'c', title: 't' });
    expect(r.description).toBeNull();
    expect(r.raisedById).toBeNull();
    expect(r.carriedDocRefIds).toEqual([]);
  });

  it('serialize → deserialize round-trip 一致', () => {
    const req = buildChangeRequest({
      clientName: '客戶B',
      title: '改流程',
      carriedDocRefIds: ['x1'],
    });
    const round = deserializeChangeRequest(serializeChangeRequest(req));
    expect(round).toEqual(req);
  });

  it('序列化為淺拷貝（修改副本不影響原物件）', () => {
    const req = buildChangeRequest({ clientName: 'c', title: 't', carriedDocRefIds: ['a'] });
    const ser = serializeChangeRequest(req);
    ser.carriedDocRefIds.push('b');
    expect(req.carriedDocRefIds).toEqual(['a']);
  });

  it('毀損資料 deserialize 拋 request_corrupt', () => {
    for (const bad of [null, undefined, 42, 'x', {}, { clientName: 'c' }, { title: 't' }]) {
      try {
        deserializeChangeRequest(bad as unknown);
        throw new Error('should throw for ' + JSON.stringify(bad));
      } catch (e) {
        expect((e as CustomizationEngineError).code).toBe('request_corrupt');
      }
    }
  });
});
