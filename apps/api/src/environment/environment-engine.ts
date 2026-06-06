import { FlowType, SaleMode, SubmissionStatus } from '@prisma/client';

/**
 * 環境建置流程引擎核心（純領域邏輯，無 DB 相依）。
 *
 * 對應需求規格 §6「環境建置流程（工程師）」：
 * - 顧問完成啟動會議後移交工程師（接收導入移交清單）。§6.2 步驟1、§3
 * - 工程師依「銷售模式」走不同建置分支：§6.1、§6.3
 *   - 買斷制（PURCHASE）：待客戶端採購主機後，安排主機環境建置（系統須可記錄此「等待採購」狀態）。
 *   - 訂閱制（SUBSCRIPTION）：開立租戶。
 * - 環境驗收，確認環境就緒。§6.2 步驟3
 *
 * 本檔僅負責「決策／結構化」：給定銷售模式、主機採購狀態與表單填寫狀態，
 * 算出建置分支與步驟骨架、主機採購等待／可建置判斷、以及驗收完成把關。
 * 真正的資料庫寫入由 EnvironmentService 依結果執行，使核心可被純函式單元測試覆蓋
 * （與 workflow / forms / templates / attachments / sales / onboarding 引擎一致）。
 */

/* ────────────────────────── 步驟與表單代碼 ────────────────────────── */

/** 環境建置流程步驟（§6.2）。 */
export enum EnvironmentStep {
  /** 1. 接收導入移交清單 */
  RECEIVE_HANDOFF = 'RECEIVE_HANDOFF',
  /** 2a. 主機建置（買斷分支） */
  HOST_BUILD = 'HOST_BUILD',
  /** 2b. 租戶開立（訂閱分支） */
  TENANT_PROVISION = 'TENANT_PROVISION',
  /** 3. 環境驗收 */
  ACCEPTANCE = 'ACCEPTANCE',
}

/** 建置分支（依銷售模式決定，§6.1）。 */
export type EnvironmentBranch = 'HOST' | 'TENANT';

/**
 * 環境建置各表單代碼（FormDefinition.code）。
 * 對應 §6.2「應產出 / 表單」欄。實際欄位內容屬 §12-3 待釐清，引擎僅以 code 標識容器。
 */
export const ENV_HANDOFF_FORM_CODE = 'ENVIRONMENT_HANDOFF'; // 移交清單（接收）
export const ENV_BUILD_CHECKLIST_FORM_CODE = 'ENVIRONMENT_BUILD_CHECKLIST'; // 環境建置檢核表（買斷）
export const ENV_TENANT_RECORD_FORM_CODE = 'ENVIRONMENT_TENANT_RECORD'; // 租戶開立紀錄（訂閱）
export const ENV_ACCEPTANCE_FORM_CODE = 'ENVIRONMENT_ACCEPTANCE'; // 環境驗收表
/** 買斷制主機採購等待／完成狀態之紀錄容器（§6.3 等待採購狀態）。 */
export const ENV_HOST_PROCUREMENT_FORM_CODE = 'ENVIRONMENT_HOST_PROCUREMENT';

/**
 * 需簽核的表單代碼集合。§6 未明定強制簽核關卡（§12-4 待釐清），預設為空；
 * 保留介面供部門日後將驗收表等納入簽核。
 */
export const ENV_SIGNABLE_FORM_CODES: ReadonlySet<string> = new Set<string>();

/** 單一步驟的預定義中介資料（可由部門自訂；此為內建預設骨架，§6.2 / §8.1）。 */
export interface EnvironmentStepDef {
  step: EnvironmentStep;
  order: number;
  name: string;
  /** 負責角色提示（對應 §2 角色；實際指派由流程定義 / 服務層決定）。 */
  responsibleHint: string;
  /** 此步驟應完成的表單代碼。 */
  formCodes: string[];
  /** 僅適用於哪個分支（未指定＝兩分支皆適用）。 */
  branch?: EnvironmentBranch;
}

/**
 * 內建環境建置流程預設骨架（§6.2）。含兩分支步驟；實際流程依銷售模式以
 * buildBranchSteps 篩選為單一分支。部門可在此基礎上自訂。
 */
export const DEFAULT_ENVIRONMENT_STEPS: readonly EnvironmentStepDef[] = Object.freeze(
  [
    {
      step: EnvironmentStep.RECEIVE_HANDOFF,
      order: 1,
      name: '接收移交',
      responsibleHint: 'ENGINEER',
      formCodes: [ENV_HANDOFF_FORM_CODE],
    },
    {
      step: EnvironmentStep.HOST_BUILD,
      order: 2,
      name: '主機建置（買斷）',
      responsibleHint: 'ENGINEER',
      formCodes: [ENV_BUILD_CHECKLIST_FORM_CODE],
      branch: 'HOST' as EnvironmentBranch,
    },
    {
      step: EnvironmentStep.TENANT_PROVISION,
      order: 2,
      name: '租戶開立（訂閱）',
      responsibleHint: 'ENGINEER',
      formCodes: [ENV_TENANT_RECORD_FORM_CODE],
      branch: 'TENANT' as EnvironmentBranch,
    },
    {
      step: EnvironmentStep.ACCEPTANCE,
      order: 3,
      name: '環境驗收',
      responsibleHint: 'ENGINEER',
      formCodes: [ENV_ACCEPTANCE_FORM_CODE],
    },
  ].map((s) => Object.freeze({ ...s, formCodes: Object.freeze([...s.formCodes]) as string[] })),
);

/* ────────────────────────── 錯誤型別 ────────────────────────── */

export type EnvironmentEngineErrorCode =
  | 'intake_invalid'
  | 'sale_mode_required'
  | 'host_purchase_pending'
  | 'branch_forms_incomplete'
  | 'acceptance_incomplete'
  | 'intake_corrupt';

export class EnvironmentEngineError extends Error {
  constructor(
    public readonly code: EnvironmentEngineErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'EnvironmentEngineError';
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/* ────────────────────────── 分支判斷（§6.1） ────────────────────────── */

/**
 * 由銷售模式決定建置分支（§6.1）。
 * - PURCHASE（買斷）→ 'HOST'（主機建置）。
 * - SUBSCRIPTION（訂閱）→ 'TENANT'（租戶開立）。
 * - 未知 → 拋 sale_mode_required（無從決定分支）。
 */
export function resolveBranch(saleMode: SaleMode | null | undefined): EnvironmentBranch {
  if (saleMode === SaleMode.PURCHASE) return 'HOST';
  if (saleMode === SaleMode.SUBSCRIPTION) return 'TENANT';
  throw new EnvironmentEngineError('sale_mode_required');
}

/** 某分支的建置產出表單代碼（買斷＝檢核表；訂閱＝租戶開立紀錄）。 */
export function branchBuildFormCode(branch: EnvironmentBranch): string {
  return branch === 'HOST' ? ENV_BUILD_CHECKLIST_FORM_CODE : ENV_TENANT_RECORD_FORM_CODE;
}

/**
 * 依銷售模式篩選出實際分支步驟骨架（§6.2）。
 * 過濾掉不屬於該分支的步驟，並把 order 重新整理為連續序號。
 */
export function buildBranchSteps(saleMode: SaleMode | null | undefined): EnvironmentStepDef[] {
  const branch = resolveBranch(saleMode);
  return DEFAULT_ENVIRONMENT_STEPS.filter((s) => !s.branch || s.branch === branch)
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s, i) => ({ ...s, order: i + 1, formCodes: [...s.formCodes] }));
}

/* ────────────────── 接收導入移交（§6.2 步驟1 / §3 流程銜接） ────────────────── */

/**
 * 導入→環境建置移交藍圖的結構性輸入（與 onboarding 模組解耦：僅依結構，
 * 不 import onboarding 型別）。對應 onboarding-engine.EnvironmentBlueprintData。
 */
export interface EnvironmentHandoffLike {
  flowType?: unknown;
  title?: unknown;
  clientName?: unknown;
  saleMode?: unknown;
  carriedDocRefIds?: unknown;
}

/** 環境建置接收到的移交內容（帶往後續建置 / 驗收引用）。 */
export interface EnvironmentIntake {
  clientName: string;
  saleMode: SaleMode | null;
  /** 由 saleMode 決定的建置分支。 */
  branch: EnvironmentBranch;
  /** 一併帶往的所有產出引用 id（去重）。 */
  carriedDocRefIds: string[];
}

function coerceSaleMode(v: unknown): SaleMode | null {
  return v === SaleMode.PURCHASE || v === SaleMode.SUBSCRIPTION ? v : null;
}

/**
 * 將導入移交藍圖轉為環境建置接收（§6.2 步驟1）。
 * - clientName 必填，否則拋 intake_invalid。
 * - saleMode 必須可決定分支，否則 resolveBranch 拋 sale_mode_required
 *   （買斷 / 訂閱走不同分支，缺銷售模式無從建置）。
 * - carriedDocRefIds 去重後帶往。
 */
export function intakeFromOnboardingHandoff(handoff: EnvironmentHandoffLike): EnvironmentIntake {
  if (!handoff || typeof handoff !== 'object') {
    throw new EnvironmentEngineError('intake_invalid');
  }
  if (!isNonEmptyString(handoff.clientName)) {
    throw new EnvironmentEngineError('intake_invalid');
  }
  const saleMode = coerceSaleMode(handoff.saleMode);
  const branch = resolveBranch(saleMode); // 缺銷售模式 → sale_mode_required
  const carried = Array.isArray(handoff.carriedDocRefIds)
    ? handoff.carriedDocRefIds.filter(isNonEmptyString)
    : [];
  return {
    clientName: handoff.clientName,
    saleMode,
    branch,
    carriedDocRefIds: [...new Set(carried)],
  };
}

/* ────────────────── 主機採購等待狀態（§6.3 買斷前置條件） ────────────────── */

/** 主機採購／建置就緒判斷結果。 */
export interface HostReadiness {
  branch: EnvironmentBranch;
  /** 買斷制是否仍在等待客戶採購主機（訂閱制恆 false）。 */
  waitingForHost: boolean;
  /** 是否可開始建置（買斷需 hostProcured；訂閱恆可）。 */
  canStartBuild: boolean;
}

/**
 * 評估建置是否就緒（§6.3）。
 * - 訂閱制（TENANT）：可直接開立租戶（不需等待，canStartBuild=true）。
 * - 買斷制（HOST）：需客戶已採購主機（hostProcured=true）才可建置；
 *   否則 waitingForHost=true，系統記錄此「等待採購」狀態。
 */
export function evaluateHostReadiness(
  saleMode: SaleMode | null | undefined,
  hostProcured: boolean,
): HostReadiness {
  const branch = resolveBranch(saleMode);
  if (branch === 'TENANT') {
    return { branch, waitingForHost: false, canStartBuild: true };
  }
  return { branch, waitingForHost: !hostProcured, canStartBuild: hostProcured };
}

/* ────────────────── 表單齊備把關（§6.2 步驟2/3） ────────────────── */

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
  signableCodes: ReadonlySet<string> = ENV_SIGNABLE_FORM_CODES,
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

/* ────────────────── 環境驗收完成把關（§6.2 步驟3、§6.3） ────────────────── */

/** 驗收完成把關輸入。 */
export interface EnvironmentCompletionInput {
  saleMode: SaleMode | null;
  /** 買斷：客戶是否已採購主機（前置條件）。訂閱忽略。 */
  hostProcured?: boolean;
  /** 目前環境建置表單填寫狀態。 */
  submissions: readonly FormStatusLike[];
}

/** 驗收完成結果。 */
export interface EnvironmentAcceptanceResult {
  branch: EnvironmentBranch;
  /** 該分支的建置產出表單代碼。 */
  buildFormCode: string;
  accepted: true;
}

/**
 * 計算環境驗收完成（§6.2 步驟3）。把關：
 * - 買斷制需客戶已採購主機，否則拋 host_purchase_pending（§6.3）。
 * - 該分支建置產出表單需齊備（買斷＝檢核表 / 訂閱＝租戶開立紀錄），
 *   否則拋 branch_forms_incomplete。
 * - 環境驗收表需完成，否則拋 acceptance_incomplete。
 * 通過後回傳驗收結果；服務層據此將案件標記為完成（就緒）。
 */
export function planAcceptance(input: EnvironmentCompletionInput): EnvironmentAcceptanceResult {
  const branch = resolveBranch(input.saleMode);
  if (branch === 'HOST' && !input.hostProcured) {
    throw new EnvironmentEngineError('host_purchase_pending');
  }
  const buildCode = branchBuildFormCode(branch);
  if (unmetForms([buildCode], input.submissions).length > 0) {
    throw new EnvironmentEngineError('branch_forms_incomplete');
  }
  if (unmetForms([ENV_ACCEPTANCE_FORM_CODE], input.submissions).length > 0) {
    throw new EnvironmentEngineError('acceptance_incomplete');
  }
  return { branch, buildFormCode: buildCode, accepted: true };
}

/* ────────────────── 環境建置接收藍圖：持久化序列化 ────────────────── */

/** 承載「導入→環境建置」接收落地的表單代碼。 */
export const ENVIRONMENT_INTAKE_FORM_CODE = 'ENVIRONMENT_INTAKE';

/** EnvironmentIntake 的 JSON-safe 表達（存入 FormSubmission.data）。 */
export interface EnvironmentIntakeData {
  clientName: string;
  saleMode: SaleMode | null;
  branch: EnvironmentBranch;
  carriedDocRefIds: string[];
}

/** 序列化環境建置接收（淺拷貝引用）。 */
export function serializeEnvironmentIntake(intake: EnvironmentIntake): EnvironmentIntakeData {
  return {
    clientName: intake.clientName,
    saleMode: intake.saleMode,
    branch: intake.branch,
    carriedDocRefIds: [...intake.carriedDocRefIds],
  };
}

/**
 * 還原持久化的環境建置接收。對毀損 / 不合法資料丟 EnvironmentEngineError('intake_corrupt')。
 */
export function deserializeEnvironmentIntake(data: unknown): EnvironmentIntakeData {
  if (!data || typeof data !== 'object') throw new EnvironmentEngineError('intake_corrupt');
  const d = data as Partial<EnvironmentIntakeData>;
  if (!isNonEmptyString(d.clientName)) throw new EnvironmentEngineError('intake_corrupt');
  if (d.branch !== 'HOST' && d.branch !== 'TENANT') {
    throw new EnvironmentEngineError('intake_corrupt');
  }
  const saleMode = coerceSaleMode(d.saleMode);
  const carried = Array.isArray(d.carriedDocRefIds)
    ? d.carriedDocRefIds.filter(isNonEmptyString)
    : [];
  return {
    clientName: d.clientName,
    saleMode,
    branch: d.branch,
    carriedDocRefIds: carried,
  };
}

/** flowType 常數匯出（供服務層建立案件，與 schema 對齊）。 */
export const ENVIRONMENT_FLOW_TYPE: FlowType = FlowType.ENVIRONMENT;
