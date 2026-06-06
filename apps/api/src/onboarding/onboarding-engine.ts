import { FlowType, SaleMode, SubmissionStatus } from '@prisma/client';

/**
 * 系統導入流程引擎核心（純領域邏輯，無 DB 相依）。
 *
 * 對應需求規格 §5「系統導入流程（顧問）」：
 * - 成案後由業務移交顧問；顧問接收銷售產出（報價單 / 客製需求文件）。§5.2 步驟1、§4.6
 * - 導入流程可由部門「預先定義」：預計工作流程、各時間點應完成事項、各時間點表單與產出。§5.1
 * - 系統於各計畫時間點主動提醒作業人員應完成事項。§5.1、§5.3
 * - 蒐集人員資料表、委任權限表（需簽核）。§5.2 步驟4、§5.3
 * - 啟動會議完成後移交工程師，建立環境建置流程。§5.2 步驟5、§3
 *
 * 本檔僅負責「決策／結構化」：給定導入時程錨點、表單填寫狀態與銷售移交內容，
 * 算出排程與提醒、必填／簽核是否齊備、以及移交工程的環境建置藍圖。
 * 真正的資料庫寫入由 OnboardingService 依結果執行，使核心可被純函式單元測試覆蓋
 * （與 workflow / forms / templates / attachments / sales 引擎一致）。
 */

/* ────────────────────────── 步驟與表單代碼 ────────────────────────── */

/** 導入流程步驟（§5.2）。 */
export enum OnboardingStep {
  /** 1. 接收銷售移交 */
  RECEIVE_HANDOFF = 'RECEIVE_HANDOFF',
  /** 2. 導入規劃 */
  PLAN = 'PLAN',
  /** 3. 啟動會議 */
  KICKOFF = 'KICKOFF',
  /** 4. 蒐集客戶資料 */
  COLLECT_DATA = 'COLLECT_DATA',
  /** 5. 移交工程 */
  HANDOFF_ENG = 'HANDOFF_ENG',
}

/**
 * 導入流程各表單代碼（FormDefinition.code）。
 * 對應 §5.2「應產出 / 表單」欄。實際欄位內容屬 §12-3 待釐清，引擎僅以 code 標識容器。
 */
export const ONBOARDING_PLAN_FORM_CODE = 'ONBOARDING_PLAN'; // 導入計畫表
export const KICKOFF_MINUTES_FORM_CODE = 'ONBOARDING_KICKOFF_MINUTES'; // 啟動會議記錄
export const STAFF_ROSTER_FORM_CODE = 'ONBOARDING_STAFF_ROSTER'; // 人員資料表
export const AUTH_DELEGATION_FORM_CODE = 'ONBOARDING_AUTH_DELEGATION'; // 委任權限表（簽核）
export const ENG_HANDOFF_FORM_CODE = 'ONBOARDING_ENG_HANDOFF'; // 移交清單

/** 需簽核的表單代碼集合（§5.3 委任權限表需簽核）。 */
export const ONBOARDING_SIGNABLE_FORM_CODES: ReadonlySet<string> = new Set([
  AUTH_DELEGATION_FORM_CODE,
]);

/** 單一步驟的預定義中介資料（可由部門自訂；此為內建預設骨架，§5.1）。 */
export interface OnboardingStepDef {
  step: OnboardingStep;
  order: number;
  name: string;
  /** 負責角色提示（對應 §2 角色；實際指派由流程定義 / 服務層決定）。 */
  responsibleHint: string;
  /** 此步驟應完成的表單代碼。 */
  formCodes: string[];
}

/**
 * 內建導入流程預設骨架（§5.2）。部門可在此基礎上自訂；引擎以此作為「預定義」預設值。
 */
export const DEFAULT_ONBOARDING_STEPS: readonly OnboardingStepDef[] = Object.freeze([
  {
    step: OnboardingStep.RECEIVE_HANDOFF,
    order: 1,
    name: '接收移交',
    responsibleHint: 'CONSULTANT',
    formCodes: [],
  },
  {
    step: OnboardingStep.PLAN,
    order: 2,
    name: '導入規劃',
    responsibleHint: 'CONSULTANT',
    formCodes: [ONBOARDING_PLAN_FORM_CODE],
  },
  {
    step: OnboardingStep.KICKOFF,
    order: 3,
    name: '啟動會議',
    responsibleHint: 'CONSULTANT',
    formCodes: [KICKOFF_MINUTES_FORM_CODE],
  },
  {
    step: OnboardingStep.COLLECT_DATA,
    order: 4,
    name: '蒐集客戶資料',
    responsibleHint: 'CONSULTANT',
    formCodes: [STAFF_ROSTER_FORM_CODE, AUTH_DELEGATION_FORM_CODE],
  },
  {
    step: OnboardingStep.HANDOFF_ENG,
    order: 5,
    name: '移交工程',
    responsibleHint: 'CONSULTANT',
    formCodes: [ENG_HANDOFF_FORM_CODE],
  },
].map((s) => Object.freeze({ ...s, formCodes: Object.freeze([...s.formCodes]) as string[] })));

/* ────────────────────────── 錯誤型別 ────────────────────────── */

export type OnboardingEngineErrorCode =
  | 'plan_anchor_required'
  | 'checkpoint_offset_invalid'
  | 'intake_invalid'
  | 'no_final_quote_in_intake'
  | 'kickoff_incomplete'
  | 'required_forms_incomplete'
  | 'auth_delegation_unsigned'
  | 'handoff_corrupt';

export class OnboardingEngineError extends Error {
  constructor(
    public readonly code: OnboardingEngineErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'OnboardingEngineError';
  }
}

/* ────────────────────── 接收銷售移交（§5.2 步驟1 / §4.6） ────────────────────── */

/**
 * 銷售移交的結構性輸入（與 sales 模組解耦：僅依結構，不 import sales 型別）。
 * 對應 sales-handoff.HandoffData。
 */
export interface SalesHandoffLike {
  finalQuote?: { refId?: unknown } | null;
  customRequirement?: { refId?: unknown } | null;
  carriedDocRefIds?: unknown;
}

/** 導入接收到的銷售產出引用（帶往後續導入 / 環境建置引用）。 */
export interface OnboardingIntake {
  /** 定版報價單引用 id。 */
  finalQuoteRefId: string;
  /** 客製需求文件引用 id（可能無）。 */
  customRequirementRefId: string | null;
  /** 一併帶往的所有產出引用 id（去重）。 */
  carriedDocRefIds: string[];
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * 將銷售移交藍圖轉為導入接收（§5.2 步驟1）。
 * - 必須有定版報價單引用，否則拋 no_final_quote_in_intake（無從接續導入）。
 * - carriedDocRefIds 會與報價單 / 客製需求引用合併並去重，作為帶往環境建置的依據。
 */
export function intakeFromSalesHandoff(handoff: SalesHandoffLike): OnboardingIntake {
  if (!handoff || typeof handoff !== 'object') throw new OnboardingEngineError('intake_invalid');
  const quoteRef = handoff.finalQuote?.refId;
  if (!isNonEmptyString(quoteRef)) throw new OnboardingEngineError('no_final_quote_in_intake');
  const customRef = handoff.customRequirement?.refId;
  const carried = Array.isArray(handoff.carriedDocRefIds)
    ? handoff.carriedDocRefIds.filter(isNonEmptyString)
    : [];
  const merged = new Set<string>([quoteRef, ...carried]);
  if (isNonEmptyString(customRef)) merged.add(customRef);
  return {
    finalQuoteRefId: quoteRef,
    customRequirementRefId: isNonEmptyString(customRef) ? customRef : null,
    carriedDocRefIds: [...merged],
  };
}

/* ────────────────── 導入排程與提醒（§5.1 預定義時間點、§5.3 主動提醒） ────────────────── */

/** 預定義時間點（相對於計畫錨點的天數位移與應完成表單）。 */
export interface OnboardingCheckpointDef {
  step: OnboardingStep;
  label: string;
  /** 相對錨點的天數位移（>= 0）。 */
  offsetDays: number;
  /** 該時間點應完成的表單代碼。 */
  formCodes: string[];
}

/** 已排定（含絕對日期）的時間點。 */
export interface ScheduledCheckpoint {
  step: OnboardingStep;
  label: string;
  offsetDays: number;
  formCodes: string[];
  /** 依錨點 + 位移（並套用排除日遞延）計算出的絕對計畫日。 */
  plannedDate: Date;
}

/**
 * 內建預設時間點骨架（§5.1）。部門可覆寫；offset 僅為合理預設。
 * 行事曆遞延（連假 / 排除日）由 4.1 提供曆法，本引擎以注入 predicate 套用（見 buildSchedule）。
 */
export const DEFAULT_ONBOARDING_CHECKPOINTS: readonly OnboardingCheckpointDef[] = Object.freeze([
  { step: OnboardingStep.PLAN, label: '導入規劃完成', offsetDays: 3, formCodes: [ONBOARDING_PLAN_FORM_CODE] },
  { step: OnboardingStep.KICKOFF, label: '啟動會議', offsetDays: 7, formCodes: [KICKOFF_MINUTES_FORM_CODE] },
  { step: OnboardingStep.COLLECT_DATA, label: '蒐集客戶資料', offsetDays: 14, formCodes: [STAFF_ROSTER_FORM_CODE, AUTH_DELEGATION_FORM_CODE] },
  { step: OnboardingStep.HANDOFF_ENG, label: '移交工程', offsetDays: 21, formCodes: [ENG_HANDOFF_FORM_CODE] },
].map((c) => Object.freeze({ ...c, formCodes: Object.freeze([...c.formCodes]) as string[] })));

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * MS_PER_DAY);
}

/**
 * 由錨點日期 + 各時間點位移，計算絕對計畫日（§5.1）。
 * - anchor 必填且需為合法日期。
 * - offsetDays 需為非負整數。
 * - 可選 isExcluded(date)：若該日為排除日 / 假日則向後遞延至第一個非排除日（§5.3、§8.3）。
 *   實際曆法來源待 4.1；預設不遞延（identity）。回傳依 plannedDate 由早到晚排序。
 */
export function buildSchedule(
  anchor: Date,
  checkpoints: readonly OnboardingCheckpointDef[] = DEFAULT_ONBOARDING_CHECKPOINTS,
  isExcluded: (date: Date) => boolean = () => false,
): ScheduledCheckpoint[] {
  if (!(anchor instanceof Date) || Number.isNaN(anchor.getTime())) {
    throw new OnboardingEngineError('plan_anchor_required');
  }
  const out: ScheduledCheckpoint[] = [];
  for (const c of checkpoints) {
    if (!Number.isInteger(c.offsetDays) || c.offsetDays < 0) {
      throw new OnboardingEngineError('checkpoint_offset_invalid');
    }
    let planned = addDays(anchor, c.offsetDays);
    let guard = 0;
    while (isExcluded(planned) && guard < 365) {
      planned = addDays(planned, 1);
      guard += 1;
    }
    out.push({
      step: c.step,
      label: c.label,
      offsetDays: c.offsetDays,
      formCodes: [...c.formCodes],
      plannedDate: planned,
    });
  }
  return out.sort((a, b) => a.plannedDate.getTime() - b.plannedDate.getTime());
}

/** 提醒項目（§5.3 主動提醒）。 */
export interface ReminderItem {
  step: OnboardingStep;
  label: string;
  plannedDate: Date;
  formCodes: string[];
  /** 距計畫日的天數（負數＝已逾期）。 */
  daysUntilDue: number;
  /** 是否已逾期（plannedDate < now）。 */
  overdue: boolean;
}

/**
 * 依「現在」算出需提醒的時間點（§5.3）。
 * - 排除已完成的步驟（completedSteps）。
 * - 納入：已逾期（plannedDate < now）或在 lookaheadDays 內即將到期者。
 * 回傳依計畫日由早到晚排序，供主動提醒負責人。
 */
export function dueReminders(
  schedule: readonly ScheduledCheckpoint[],
  now: Date = new Date(),
  lookaheadDays = 3,
  completedSteps: ReadonlySet<OnboardingStep> = new Set(),
): ReminderItem[] {
  const horizon = addDays(now, lookaheadDays);
  const items: ReminderItem[] = [];
  for (const c of schedule) {
    if (completedSteps.has(c.step)) continue;
    if (c.plannedDate.getTime() > horizon.getTime()) continue;
    const diffMs = c.plannedDate.getTime() - now.getTime();
    items.push({
      step: c.step,
      label: c.label,
      plannedDate: c.plannedDate,
      formCodes: [...c.formCodes],
      daysUntilDue: Math.ceil(diffMs / MS_PER_DAY),
      overdue: diffMs < 0,
    });
  }
  return items.sort((a, b) => a.plannedDate.getTime() - b.plannedDate.getTime());
}

/* ────────────────── 表單齊備 / 簽核把關（§5.2 步驟4、§5.3） ────────────────── */

/** 表單填寫狀態最小投影（對應 FormSubmission）。 */
export interface FormStatusLike {
  formCode: string;
  status: SubmissionStatus;
}

/**
 * 判斷一組「應完成表單代碼」是否齊備。
 * - 一般表單：需有一筆 SUBMITTED 或 APPROVED。
 * - 簽核表單（signableCodes 內，如委任權限表）：必須 APPROVED 才算齊備（§5.3）。
 * 回傳尚未齊備的表單代碼陣列（空陣列代表齊備）。
 */
export function unmetForms(
  requiredCodes: readonly string[],
  submissions: readonly FormStatusLike[],
  signableCodes: ReadonlySet<string> = ONBOARDING_SIGNABLE_FORM_CODES,
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

/** 委任權限表是否已簽核（APPROVED）。§5.3 */
export function isAuthDelegationSigned(submissions: readonly FormStatusLike[]): boolean {
  return submissions.some(
    (s) => s.formCode === AUTH_DELEGATION_FORM_CODE && s.status === SubmissionStatus.APPROVED,
  );
}

/* ────────────────── 移交工程：建立環境建置案件藍圖（§5.2 步驟5、§3） ────────────────── */

/** 移交工程的把關輸入。 */
export interface EngineeringHandoffInput {
  intake: OnboardingIntake;
  /** 客戶名稱（建立環境建置案件用）。 */
  clientName: string;
  /** 銷售模式（決定環境建置分支：買斷 / 訂閱，§6.1）；可能未知。 */
  saleMode: SaleMode | null;
  /** 啟動會議是否完成（§5.1 啟動會議完成後始可移交）。 */
  kickoffCompleted: boolean;
  /** 目前導入表單填寫狀態（檢核 COLLECT_DATA 必填，含委任權限表簽核）。 */
  submissions: readonly FormStatusLike[];
  /** 導入過程另需帶往的產出引用（如啟動會議記錄、人員資料表附件 id），選填。 */
  extraDocRefIds?: readonly string[];
}

/**
 * 建立後續「環境建置」案件的藍圖（§3 流程銜接、§5.2 步驟5）。
 * - flowType 固定為 ENVIRONMENT。
 * - 帶往銷售產出（報價單 / 客製需求）＋導入產出引用，供工程師接續引用（§4.6、§8.2）。
 * - saleMode 帶往，使環境建置可依買斷 / 訂閱走不同分支（§6.1）。
 */
export interface EnvironmentCaseBlueprint {
  flowType: FlowType;
  title: string;
  clientName: string;
  saleMode: SaleMode | null;
  /** 帶往環境建置的所有產出引用（去重）。 */
  carriedDocRefIds: string[];
}

/**
 * 計算「移交工程」計畫（§5.2 步驟5）。把關：
 * - 啟動會議需完成，否則拋 kickoff_incomplete（§5.1）。
 * - 蒐集客戶資料之必填表單需齊備，否則拋 required_forms_incomplete（§5.2 步驟4）。
 * - 委任權限表需已簽核，否則拋 auth_delegation_unsigned（§5.3）。
 * 通過後回傳環境建置案件藍圖；服務層據此建立 ENVIRONMENT 案件並連結。
 */
export function planEngineeringHandoff(input: EngineeringHandoffInput): EnvironmentCaseBlueprint {
  if (!input.kickoffCompleted) throw new OnboardingEngineError('kickoff_incomplete');

  const collectStep = DEFAULT_ONBOARDING_STEPS.find((s) => s.step === OnboardingStep.COLLECT_DATA);
  const requiredCodes = collectStep ? collectStep.formCodes : [];
  const unmet = unmetForms(requiredCodes, input.submissions);
  if (unmet.length > 0) {
    // 委任權限表未簽核給更精確的錯誤碼，便於前端引導補簽。
    if (unmet.includes(AUTH_DELEGATION_FORM_CODE) && !isAuthDelegationSigned(input.submissions)) {
      // 若其餘皆齊、僅缺委任權限表簽核，回報 auth_delegation_unsigned。
      const othersUnmet = unmet.filter((c) => c !== AUTH_DELEGATION_FORM_CODE);
      if (othersUnmet.length === 0) throw new OnboardingEngineError('auth_delegation_unsigned');
    }
    throw new OnboardingEngineError('required_forms_incomplete');
  }

  const carried = new Set<string>([...input.intake.carriedDocRefIds]);
  for (const ref of input.extraDocRefIds ?? []) {
    if (isNonEmptyString(ref)) carried.add(ref);
  }

  return {
    flowType: FlowType.ENVIRONMENT,
    title: `環境建置 - ${input.clientName}`,
    clientName: input.clientName,
    saleMode: input.saleMode,
    carriedDocRefIds: [...carried],
  };
}

/* ────────────────── 環境建置移交藍圖：持久化序列化 ────────────────── */

/** 承載「導入→環境建置」移交藍圖落地的表單代碼。 */
export const ONBOARDING_HANDOFF_FORM_CODE = 'ONBOARDING_ENG_HANDOFF_BLUEPRINT';

/** EnvironmentCaseBlueprint 的 JSON-safe 表達（存入 FormSubmission.data）。 */
export interface EnvironmentBlueprintData {
  flowType: FlowType;
  title: string;
  clientName: string;
  saleMode: SaleMode | null;
  carriedDocRefIds: string[];
}

/** 序列化環境建置藍圖（淺拷貝引用）。 */
export function serializeEnvironmentBlueprint(
  bp: EnvironmentCaseBlueprint,
): EnvironmentBlueprintData {
  return {
    flowType: bp.flowType,
    title: bp.title,
    clientName: bp.clientName,
    saleMode: bp.saleMode,
    carriedDocRefIds: [...bp.carriedDocRefIds],
  };
}

/**
 * 還原持久化的環境建置藍圖。對毀損 / 不合法資料丟 OnboardingEngineError('handoff_corrupt')。
 */
export function deserializeEnvironmentBlueprint(data: unknown): EnvironmentBlueprintData {
  if (!data || typeof data !== 'object') throw new OnboardingEngineError('handoff_corrupt');
  const d = data as Partial<EnvironmentBlueprintData>;
  if (d.flowType !== FlowType.ENVIRONMENT) throw new OnboardingEngineError('handoff_corrupt');
  if (!isNonEmptyString(d.title)) throw new OnboardingEngineError('handoff_corrupt');
  if (!isNonEmptyString(d.clientName)) throw new OnboardingEngineError('handoff_corrupt');
  const saleMode =
    d.saleMode === SaleMode.PURCHASE || d.saleMode === SaleMode.SUBSCRIPTION ? d.saleMode : null;
  const carried = Array.isArray(d.carriedDocRefIds)
    ? d.carriedDocRefIds.filter(isNonEmptyString)
    : [];
  return {
    flowType: FlowType.ENVIRONMENT,
    title: d.title,
    clientName: d.clientName,
    saleMode,
    carriedDocRefIds: carried,
  };
}
