import { FlowType, SubmissionStatus } from '@prisma/client';

/**
 * 客製化（需求變更）流程引擎核心（純領域邏輯，無 DB 相依）。
 *
 * 對應需求規格 §7「客製化（需求變更）流程」：
 * - 客戶上線後提出客製需求 → 顧問發起需求變更單。§7.1、§7.2 步驟1
 * - 顧問指派工程主管 → 工程主管分派工程師。§7.2 步驟2/3（指派鏈）
 * - 工程師客製開發 → 撰寫測試文件 → 交付顧問複測。§7.2 步驟4/5/6
 * - 複測不通過：退回工程師重新開發（流程可循環）。§7.3
 * - 複測通過：更新客戶「測試區」→ 驗證無誤後更新「正式區」（兩道關卡，分別記錄）。§7.2 步驟7/8、§7.3
 *
 * 本檔僅負責「決策／狀態機／結構化」：給定目前狀態與動作，算出下一狀態、
 * 指派鏈把關、複測退回循環、以及測試區／正式區兩道關卡的前置條件把關。
 * 真正的資料庫寫入由 CustomizationService 依結果執行，使核心可被純函式單元測試覆蓋
 * （與 workflow / forms / templates / attachments / sales / onboarding / environment 引擎一致）。
 */

/* ────────────────────────── 步驟與表單代碼 ────────────────────────── */

/** 客製化流程步驟（§7.2）。 */
export enum CustomizationStep {
  /** 1. 發起需求變更（顧問） */
  RAISE_REQUEST = 'RAISE_REQUEST',
  /** 2. 指派工程主管（顧問） */
  ASSIGN_LEAD = 'ASSIGN_LEAD',
  /** 3. 分派工程師（工程主管） */
  ASSIGN_ENGINEER = 'ASSIGN_ENGINEER',
  /** 4. 客製開發（工程師） */
  DEVELOP = 'DEVELOP',
  /** 5. 撰寫測試文件（工程師） */
  WRITE_TEST_DOC = 'WRITE_TEST_DOC',
  /** 6. 複測（顧問） */
  RETEST = 'RETEST',
  /** 7. 更新測試區（工程師） */
  DEPLOY_TEST = 'DEPLOY_TEST',
  /** 8. 更新正式區（工程師） */
  DEPLOY_PROD = 'DEPLOY_PROD',
}

/**
 * 客製化各表單代碼（FormDefinition.code）。
 * 對應 §7.2「應產出 / 表單」欄。實際欄位內容屬 §12-3 待釐清，引擎僅以 code 標識容器。
 */
export const CHANGE_REQUEST_FORM_CODE = 'CUSTOMIZATION_CHANGE_REQUEST'; // 需求變更單（步驟1）
export const DEV_TASK_FORM_CODE = 'CUSTOMIZATION_DEV_TASK'; // 開發任務單（步驟3）
export const DEV_RECORD_FORM_CODE = 'CUSTOMIZATION_DEV_RECORD'; // 開發紀錄（步驟4）
export const TEST_DOC_FORM_CODE = 'CUSTOMIZATION_TEST_DOC'; // 測試文件（步驟5）
export const RETEST_REPORT_FORM_CODE = 'CUSTOMIZATION_RETEST_REPORT'; // 複測報告（步驟6）
export const TEST_DEPLOY_FORM_CODE = 'CUSTOMIZATION_TEST_DEPLOY_RECORD'; // 測試區更新紀錄（步驟7）
export const PROD_DEPLOY_FORM_CODE = 'CUSTOMIZATION_PROD_DEPLOY_RECORD'; // 正式區上線紀錄（步驟8）

/**
 * 需簽核的表單代碼集合。§7 未明定強制簽核關卡（§12-4 待釐清），預設為空；
 * 保留介面供部門日後將複測報告 / 正式區上線紀錄等納入簽核。
 */
export const CUSTOMIZATION_SIGNABLE_FORM_CODES: ReadonlySet<string> = new Set<string>();

/** 角色提示常數（對應 §2 角色 / RoleCode；實際指派把關由服務層 RBAC 決定）。 */
export const ROLE_CONSULTANT = 'CONSULTANT';
export const ROLE_ENG_LEAD = 'ENG_LEAD';
export const ROLE_ENGINEER = 'ENGINEER';

/** 單一步驟的預定義中介資料（可由部門自訂；此為內建預設骨架，§7.2 / §8.1）。 */
export interface CustomizationStepDef {
  step: CustomizationStep;
  order: number;
  name: string;
  /** 負責角色提示（對應 §2 角色；實際指派由流程定義 / 服務層決定）。 */
  responsibleHint: string;
  /** 此步驟應完成的表單代碼。 */
  formCodes: string[];
}

/**
 * 內建客製化流程預設骨架（§7.2）。部門可在此基礎上自訂（§8.1）。
 */
export const DEFAULT_CUSTOMIZATION_STEPS: readonly CustomizationStepDef[] = Object.freeze(
  [
    {
      step: CustomizationStep.RAISE_REQUEST,
      order: 1,
      name: '發起需求變更',
      responsibleHint: ROLE_CONSULTANT,
      formCodes: [CHANGE_REQUEST_FORM_CODE],
    },
    {
      step: CustomizationStep.ASSIGN_LEAD,
      order: 2,
      name: '指派工程主管',
      responsibleHint: ROLE_CONSULTANT,
      formCodes: [],
    },
    {
      step: CustomizationStep.ASSIGN_ENGINEER,
      order: 3,
      name: '分派工程師',
      responsibleHint: ROLE_ENG_LEAD,
      formCodes: [DEV_TASK_FORM_CODE],
    },
    {
      step: CustomizationStep.DEVELOP,
      order: 4,
      name: '客製開發',
      responsibleHint: ROLE_ENGINEER,
      formCodes: [DEV_RECORD_FORM_CODE],
    },
    {
      step: CustomizationStep.WRITE_TEST_DOC,
      order: 5,
      name: '撰寫測試文件',
      responsibleHint: ROLE_ENGINEER,
      formCodes: [TEST_DOC_FORM_CODE],
    },
    {
      step: CustomizationStep.RETEST,
      order: 6,
      name: '複測',
      responsibleHint: ROLE_CONSULTANT,
      formCodes: [RETEST_REPORT_FORM_CODE],
    },
    {
      step: CustomizationStep.DEPLOY_TEST,
      order: 7,
      name: '更新測試區',
      responsibleHint: ROLE_ENGINEER,
      formCodes: [TEST_DEPLOY_FORM_CODE],
    },
    {
      step: CustomizationStep.DEPLOY_PROD,
      order: 8,
      name: '更新正式區',
      responsibleHint: ROLE_ENGINEER,
      formCodes: [PROD_DEPLOY_FORM_CODE],
    },
  ].map((s) => Object.freeze({ ...s, formCodes: Object.freeze([...s.formCodes]) as string[] })),
);

/* ────────────────────────── 錯誤型別 ────────────────────────── */

export type CustomizationEngineErrorCode =
  | 'request_invalid'
  | 'assignee_required'
  | 'invalid_transition'
  | 'forms_incomplete'
  | 'retest_not_passed'
  | 'test_deploy_pending'
  | 'request_corrupt';

export class CustomizationEngineError extends Error {
  constructor(
    public readonly code: CustomizationEngineErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'CustomizationEngineError';
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/* ────────────────────────── 狀態機（§7 指派鏈 + 複測退回循環 + 兩道關卡） ────────────────────────── */

/**
 * 客製化案件狀態（驅動指派鏈、複測退回與測試區→正式區兩道關卡）。
 * 與 schema 之 CaseStatus 解耦：本狀態描述「流程進行到哪一步」，
 * 服務層另以 CaseStatus 反映案件整體生命週期（IN_PROGRESS / COMPLETED 等）。
 */
export enum CustomizationState {
  /** 需求變更單建立中（尚未提交） */
  DRAFT = 'DRAFT',
  /** 已登錄需求變更，待顧問指派工程主管 */
  PENDING_LEAD_ASSIGN = 'PENDING_LEAD_ASSIGN',
  /** 已指派工程主管，待其分派工程師 */
  PENDING_ENGINEER_ASSIGN = 'PENDING_ENGINEER_ASSIGN',
  /** 工程師開發中（含撰寫測試文件） */
  IN_DEVELOPMENT = 'IN_DEVELOPMENT',
  /** 顧問複測中 */
  IN_RETEST = 'IN_RETEST',
  /** 複測通過，更新客戶測試區（第一道關卡） */
  DEPLOYING_TEST = 'DEPLOYING_TEST',
  /** 測試區無誤，更新客戶正式區（第二道關卡） */
  DEPLOYING_PROD = 'DEPLOYING_PROD',
  /** 正式區上線完成 */
  COMPLETED = 'COMPLETED',
}

/** 狀態機可觸發的動作。 */
export enum CustomizationAction {
  /** 提交需求變更單（DRAFT → PENDING_LEAD_ASSIGN） */
  SUBMIT_REQUEST = 'SUBMIT_REQUEST',
  /** 指派工程主管（PENDING_LEAD_ASSIGN → PENDING_ENGINEER_ASSIGN） */
  ASSIGN_LEAD = 'ASSIGN_LEAD',
  /** 分派工程師（PENDING_ENGINEER_ASSIGN → IN_DEVELOPMENT） */
  ASSIGN_ENGINEER = 'ASSIGN_ENGINEER',
  /** 送交複測（IN_DEVELOPMENT → IN_RETEST） */
  SUBMIT_FOR_RETEST = 'SUBMIT_FOR_RETEST',
  /** 複測通過（IN_RETEST → DEPLOYING_TEST） */
  RETEST_PASS = 'RETEST_PASS',
  /** 複測不通過，退回開發（IN_RETEST → IN_DEVELOPMENT） §7.3 */
  RETEST_FAIL = 'RETEST_FAIL',
  /** 測試區更新完成（DEPLOYING_TEST → DEPLOYING_PROD）第一道關卡 */
  CONFIRM_TEST_DEPLOY = 'CONFIRM_TEST_DEPLOY',
  /** 正式區更新完成（DEPLOYING_PROD → COMPLETED）第二道關卡 */
  CONFIRM_PROD_DEPLOY = 'CONFIRM_PROD_DEPLOY',
}

/**
 * 狀態轉移表（§7）。key=目前狀態，value=該狀態允許的動作→下一狀態。
 * 特別注意 RETEST_FAIL 回到 IN_DEVELOPMENT，形成複測退回循環（§7.3）。
 */
const TRANSITIONS: Readonly<
  Record<CustomizationState, Partial<Record<CustomizationAction, CustomizationState>>>
> = Object.freeze({
  [CustomizationState.DRAFT]: {
    [CustomizationAction.SUBMIT_REQUEST]: CustomizationState.PENDING_LEAD_ASSIGN,
  },
  [CustomizationState.PENDING_LEAD_ASSIGN]: {
    [CustomizationAction.ASSIGN_LEAD]: CustomizationState.PENDING_ENGINEER_ASSIGN,
  },
  [CustomizationState.PENDING_ENGINEER_ASSIGN]: {
    [CustomizationAction.ASSIGN_ENGINEER]: CustomizationState.IN_DEVELOPMENT,
  },
  [CustomizationState.IN_DEVELOPMENT]: {
    [CustomizationAction.SUBMIT_FOR_RETEST]: CustomizationState.IN_RETEST,
  },
  [CustomizationState.IN_RETEST]: {
    [CustomizationAction.RETEST_PASS]: CustomizationState.DEPLOYING_TEST,
    [CustomizationAction.RETEST_FAIL]: CustomizationState.IN_DEVELOPMENT,
  },
  [CustomizationState.DEPLOYING_TEST]: {
    [CustomizationAction.CONFIRM_TEST_DEPLOY]: CustomizationState.DEPLOYING_PROD,
  },
  [CustomizationState.DEPLOYING_PROD]: {
    [CustomizationAction.CONFIRM_PROD_DEPLOY]: CustomizationState.COMPLETED,
  },
  [CustomizationState.COMPLETED]: {},
});

/** 某狀態下某動作是否合法。 */
export function canTransition(state: CustomizationState, action: CustomizationAction): boolean {
  return TRANSITIONS[state]?.[action] !== undefined;
}

/**
 * 計算狀態機下一狀態。非法轉移拋 invalid_transition。
 * 此為純函式；前置條件（表單齊備、指派人選等）由各 plan* 函式另行把關。
 */
export function nextState(
  state: CustomizationState,
  action: CustomizationAction,
): CustomizationState {
  const to = TRANSITIONS[state]?.[action];
  if (to === undefined) {
    throw new CustomizationEngineError(
      'invalid_transition',
      `cannot ${action} from ${state}`,
    );
  }
  return to;
}

/** RETEST_FAIL 視為「退回」（StepInstanceStatus.RETURNED 對應），供服務層記錄退回語意。 */
export function isReturnAction(action: CustomizationAction): boolean {
  return action === CustomizationAction.RETEST_FAIL;
}

/* ────────────────────────── 指派鏈把關（§7.2 步驟2/3） ────────────────────────── */

/** 指派輸入（指派鏈：顧問→工程主管→工程師）。 */
export interface AssignmentInput {
  /** 被指派人 userId。 */
  assigneeId: string;
  /** 被指派人的角色代碼（用於和期望角色比對；服務層由 DB 帶入）。 */
  assigneeRole?: string | null;
}

/** 指派結果。 */
export interface AssignmentResult {
  step: CustomizationStep;
  assigneeId: string;
  /** 此次指派期望的角色（提示，未強制；§12-1 核可關卡待釐清）。 */
  expectedRole: string;
  /** 被指派人角色是否與期望相符（assigneeRole 未提供時為 null＝未驗證）。 */
  roleMatches: boolean | null;
}

function planAssignment(
  input: AssignmentInput,
  step: CustomizationStep,
  expectedRole: string,
): AssignmentResult {
  if (!input || !isNonEmptyString(input.assigneeId)) {
    throw new CustomizationEngineError('assignee_required');
  }
  const roleMatches = isNonEmptyString(input.assigneeRole)
    ? input.assigneeRole === expectedRole
    : null;
  return { step, assigneeId: input.assigneeId, expectedRole, roleMatches };
}

/** 顧問指派工程主管（§7.2 步驟2）。 */
export function planAssignLead(input: AssignmentInput): AssignmentResult {
  return planAssignment(input, CustomizationStep.ASSIGN_LEAD, ROLE_ENG_LEAD);
}

/** 工程主管分派工程師（§7.2 步驟3）。 */
export function planAssignEngineer(input: AssignmentInput): AssignmentResult {
  return planAssignment(input, CustomizationStep.ASSIGN_ENGINEER, ROLE_ENGINEER);
}

/* ────────────────────────── 表單齊備把關（§7.2 各步驟產出） ────────────────────────── */

/** 表單填寫狀態最小投影（對應 FormSubmission）。 */
export interface FormStatusLike {
  formCode: string;
  status: SubmissionStatus;
}

/**
 * 判斷一組「應完成表單代碼」是否齊備。
 * - 一般表單：需有一筆 SUBMITTED 或 APPROVED。
 * - 簽核表單（signableCodes 內）：必須 APPROVED 才算齊備。
 * 回傳尚未齊備的表單代碼陣列（空陣列代表齊備）。
 */
export function unmetForms(
  requiredCodes: readonly string[],
  submissions: readonly FormStatusLike[],
  signableCodes: ReadonlySet<string> = CUSTOMIZATION_SIGNABLE_FORM_CODES,
): string[] {
  const unmet: string[] = [];
  for (const code of requiredCodes) {
    const subs = submissions.filter((s) => s.formCode === code);
    const ok = subs.some((s) =>
      signableCodes.has(code)
        ? s.status === SubmissionStatus.APPROVED
        : s.status === SubmissionStatus.SUBMITTED || s.status === SubmissionStatus.APPROVED,
    );
    if (!ok) unmet.push(code);
  }
  return unmet;
}

/* ────────────────────────── 送交複測把關（§7.2 步驟4/5/6） ────────────────────────── */

/**
 * 送交複測前置把關（IN_DEVELOPMENT → IN_RETEST）。
 * 工程師須完成開發紀錄（步驟4）與測試文件（步驟5）才可交付顧問複測（步驟6）。
 * 任一未齊備拋 forms_incomplete。
 */
export function planSubmitForRetest(submissions: readonly FormStatusLike[]): {
  ready: true;
  requiredForms: string[];
} {
  const required = [DEV_RECORD_FORM_CODE, TEST_DOC_FORM_CODE];
  if (unmetForms(required, submissions).length > 0) {
    throw new CustomizationEngineError('forms_incomplete');
  }
  return { ready: true, requiredForms: required };
}

/* ────────────────────────── 複測結果（§7.3 退回循環） ────────────────────────── */

/** 複測結果輸入。 */
export interface RetestInput {
  passed: boolean;
  /** 目前已退回次數（供累計；服務層由歷史紀錄帶入）。 */
  priorReturnCount?: number;
}

/** 複測結果。 */
export interface RetestResult {
  passed: boolean;
  /** 複測後狀態：通過→DEPLOYING_TEST；不通過→IN_DEVELOPMENT（退回）。 */
  nextState: CustomizationState;
  /** 是否觸發退回（不通過＝true）。 */
  returned: boolean;
  /** 退回累計次數（通過時維持 prior；不通過時 +1）。 */
  returnCount: number;
}

/**
 * 套用複測結果（§7.2 步驟6、§7.3）。
 * - 通過：進入 DEPLOYING_TEST（準備更新測試區）。
 * - 不通過：退回 IN_DEVELOPMENT（工程師重新開發），退回次數 +1，形成循環。
 * 僅可於 IN_RETEST 狀態套用，否則拋 invalid_transition。
 */
export function applyRetestResult(state: CustomizationState, input: RetestInput): RetestResult {
  if (state !== CustomizationState.IN_RETEST) {
    throw new CustomizationEngineError(
      'invalid_transition',
      `retest result only valid in IN_RETEST (got ${state})`,
    );
  }
  const prior = Number.isInteger(input.priorReturnCount) ? (input.priorReturnCount as number) : 0;
  if (input.passed) {
    return {
      passed: true,
      nextState: nextState(state, CustomizationAction.RETEST_PASS),
      returned: false,
      returnCount: prior,
    };
  }
  return {
    passed: false,
    nextState: nextState(state, CustomizationAction.RETEST_FAIL),
    returned: true,
    returnCount: prior + 1,
  };
}

/* ────────────────────────── 兩道關卡把關（§7.2 步驟7/8、§7.3） ────────────────────────── */

/** 部署關卡。 */
export type DeployGate = 'TEST' | 'PROD';

/** 部署關卡把關結果。 */
export interface DeployGateResult {
  gate: DeployGate;
  /** 該關卡應記錄的表單代碼。 */
  recordFormCode: string;
  nextState: CustomizationState;
  confirmed: true;
}

/**
 * 確認「更新測試區」第一道關卡（§7.2 步驟7）。
 * 前置：複測須已通過（state=DEPLOYING_TEST），且測試區更新紀錄已填。
 * - 非 DEPLOYING_TEST 狀態 → retest_not_passed（複測未通過不得進測試區）。
 * - 測試區更新紀錄未齊備 → forms_incomplete。
 */
export function planTestDeployment(
  state: CustomizationState,
  submissions: readonly FormStatusLike[],
): DeployGateResult {
  if (state !== CustomizationState.DEPLOYING_TEST) {
    throw new CustomizationEngineError('retest_not_passed');
  }
  if (unmetForms([TEST_DEPLOY_FORM_CODE], submissions).length > 0) {
    throw new CustomizationEngineError('forms_incomplete');
  }
  return {
    gate: 'TEST',
    recordFormCode: TEST_DEPLOY_FORM_CODE,
    nextState: nextState(state, CustomizationAction.CONFIRM_TEST_DEPLOY),
    confirmed: true,
  };
}

/**
 * 確認「更新正式區」第二道關卡（§7.2 步驟8、§7.3）。
 * 前置：測試區須已確認無誤（state=DEPLOYING_PROD），且正式區上線紀錄已填。
 * - 非 DEPLOYING_PROD 狀態 → test_deploy_pending（測試區未確認不得上正式區）。
 * - 正式區上線紀錄未齊備 → forms_incomplete。
 */
export function planProductionDeployment(
  state: CustomizationState,
  submissions: readonly FormStatusLike[],
): DeployGateResult {
  if (state !== CustomizationState.DEPLOYING_PROD) {
    throw new CustomizationEngineError('test_deploy_pending');
  }
  if (unmetForms([PROD_DEPLOY_FORM_CODE], submissions).length > 0) {
    throw new CustomizationEngineError('forms_incomplete');
  }
  return {
    gate: 'PROD',
    recordFormCode: PROD_DEPLOY_FORM_CODE,
    nextState: nextState(state, CustomizationAction.CONFIRM_PROD_DEPLOY),
    confirmed: true,
  };
}

/* ────────────────────────── 需求變更單：持久化序列化 ────────────────────────── */

/** 承載「需求變更單」接收落地的表單代碼（即 CHANGE_REQUEST_FORM_CODE）。 */
export const CUSTOMIZATION_REQUEST_FORM_CODE = CHANGE_REQUEST_FORM_CODE;

/** 需求變更單的結構性輸入（顧問發起，§7.2 步驟1）。 */
export interface ChangeRequestInput {
  /** 客戶名稱。 */
  clientName: string;
  /** 變更需求標題 / 摘要。 */
  title: string;
  /** 詳細需求描述（選填）。 */
  description?: string | null;
  /** 發起顧問 userId（選填）。 */
  raisedById?: string | null;
  /** 一併引用的前段產出 id（如報價單 / 既有客製文件；去重）。 */
  carriedDocRefIds?: string[];
}

/** ChangeRequest 的 JSON-safe 表達（存入 FormSubmission.data）。 */
export interface ChangeRequestData {
  clientName: string;
  title: string;
  description: string | null;
  raisedById: string | null;
  carriedDocRefIds: string[];
}

/**
 * 建立 / 正規化需求變更單（§7.2 步驟1）。
 * - clientName、title 必填，否則拋 request_invalid。
 * - carriedDocRefIds 去重後帶往（§8.2 前段產出帶往後續引用）。
 */
export function buildChangeRequest(input: ChangeRequestInput): ChangeRequestData {
  if (!input || typeof input !== 'object') {
    throw new CustomizationEngineError('request_invalid');
  }
  if (!isNonEmptyString(input.clientName) || !isNonEmptyString(input.title)) {
    throw new CustomizationEngineError('request_invalid');
  }
  const carried = Array.isArray(input.carriedDocRefIds)
    ? input.carriedDocRefIds.filter(isNonEmptyString)
    : [];
  return {
    clientName: input.clientName,
    title: input.title,
    description: isNonEmptyString(input.description) ? input.description : null,
    raisedById: isNonEmptyString(input.raisedById) ? input.raisedById : null,
    carriedDocRefIds: [...new Set(carried)],
  };
}

/** 序列化需求變更單（淺拷貝引用）。 */
export function serializeChangeRequest(req: ChangeRequestData): ChangeRequestData {
  return {
    clientName: req.clientName,
    title: req.title,
    description: req.description,
    raisedById: req.raisedById,
    carriedDocRefIds: [...req.carriedDocRefIds],
  };
}

/**
 * 還原持久化的需求變更單。對毀損 / 不合法資料丟 CustomizationEngineError('request_corrupt')。
 */
export function deserializeChangeRequest(data: unknown): ChangeRequestData {
  if (!data || typeof data !== 'object') throw new CustomizationEngineError('request_corrupt');
  const d = data as Partial<ChangeRequestData>;
  if (!isNonEmptyString(d.clientName) || !isNonEmptyString(d.title)) {
    throw new CustomizationEngineError('request_corrupt');
  }
  const carried = Array.isArray(d.carriedDocRefIds)
    ? d.carriedDocRefIds.filter(isNonEmptyString)
    : [];
  return {
    clientName: d.clientName,
    title: d.title,
    description: isNonEmptyString(d.description) ? d.description : null,
    raisedById: isNonEmptyString(d.raisedById) ? d.raisedById : null,
    carriedDocRefIds: carried,
  };
}

/** flowType 常數匯出（供服務層建立案件，與 schema 對齊）。 */
export const CUSTOMIZATION_FLOW_TYPE: FlowType = FlowType.CUSTOMIZATION;
