import { FlowType, ProjectStatus } from '@prisma/client';

/**
 * 專案管理流程引擎（§5.1 / 規格 §3、§6.1）。
 *
 * **純邏輯**：不依賴 DB / Nest，可被純函式測試（與 2.x / 3.x / 4.x 同風格）。
 * 範圍對應 issue 5.1：專案 CRUD 的輸入驗證、專案代碼產生、狀態機，以及把案件（流程實例）
 * 掛載至專案的「計畫起迄」視窗驗證（允許先後與重疊）。
 *
 * 不在本引擎處理（屬後續 issue）：
 * - 甘特圖呈現（5.2）。
 * - 延遲／超前判斷與容許門檻 T（5.3）。
 * - 行事曆排除日順延重算（5.4，串接 4.1 calendar-engine）。
 *
 * 進度認定：本輪僅提供「步驟完成比例」（規格 §4.1 預設建議）作為 flow progress 來源，
 * 其餘認定方式（加權工時／人工填報，§9-1）待主管確認。
 */

/** 引擎錯誤（帶可程式判讀的 code）。 */
export class ProjectEngineError extends Error {
  constructor(
    readonly code:
      | 'name_required'
      | 'client_required'
      | 'owner_required'
      | 'invalid_date'
      | 'invalid_plan_window'
      | 'invalid_sequence'
      | 'flow_type_required'
      | 'flow_name_required'
      | 'invalid_progress'
      | 'invalid_status_transition'
      | 'project_corrupt',
    message: string,
  ) {
    super(message);
    this.name = 'ProjectEngineError';
  }
}

/** 專案代碼前綴。 */
export const PROJECT_CODE_PREFIX = 'PRJ';

/** 日界一律以 UTC 判斷（與 4.1 calendar-engine 一致，避免時區跨日誤差）。 */
function parseDate(value: Date | string, field: string): Date {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new ProjectEngineError('invalid_date', `${field} 不是合法日期：${String(value)}`);
  }
  return d;
}

/** YYYYMM（UTC）。 */
function yearMonthUtc(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${y}${m}`;
}

/**
 * 產生專案代碼：`PRJ-YYYYMM-####`（序號補零 4 位）。
 * sequence 由呼叫端（服務層）以「該月已建立專案數 + 1」提供；碰撞時遞增重試（服務層負責）。
 */
export function generateProjectCode(params: { now?: Date; sequence: number }): string {
  const now = params.now ?? new Date();
  const seq = Math.trunc(params.sequence);
  if (!Number.isFinite(seq) || seq < 1) {
    throw new ProjectEngineError('invalid_sequence', `sequence 必須為正整數：${String(params.sequence)}`);
  }
  return `${PROJECT_CODE_PREFIX}-${yearMonthUtc(now)}-${seq.toString().padStart(4, '0')}`;
}

/** 專案建立／編輯輸入（原始）。 */
export interface ProjectDraftInput {
  name?: string | null;
  client?: string | null;
  ownerId?: string | null;
  planStart?: Date | string | null;
  planEnd?: Date | string | null;
}

/** 已正規化的專案計畫資料。 */
export interface NormalizedProject {
  name: string;
  client: string;
  ownerId: string;
  planStart: Date;
  planEnd: Date;
}

/**
 * 驗證並正規化專案輸入（建立用，全欄位必填）。
 * 規則：name / client / ownerId 去頭尾空白後非空；planStart / planEnd 合法；planEnd >= planStart。
 */
export function buildProjectDraft(input: ProjectDraftInput): NormalizedProject {
  const name = (input.name ?? '').trim();
  if (!name) throw new ProjectEngineError('name_required', '專案名稱必填');
  const client = (input.client ?? '').trim();
  if (!client) throw new ProjectEngineError('client_required', '客戶名稱必填');
  const ownerId = (input.ownerId ?? '').trim();
  if (!ownerId) throw new ProjectEngineError('owner_required', '專案負責人必填');

  if (input.planStart == null) throw new ProjectEngineError('invalid_date', 'planStart 必填');
  if (input.planEnd == null) throw new ProjectEngineError('invalid_date', 'planEnd 必填');
  const planStart = parseDate(input.planStart, 'planStart');
  const planEnd = parseDate(input.planEnd, 'planEnd');
  if (planEnd.getTime() < planStart.getTime()) {
    throw new ProjectEngineError('invalid_plan_window', 'planEnd 不可早於 planStart');
  }
  return { name, client, ownerId, planStart, planEnd };
}

/** 部分更新：僅驗證提供到的欄位；若同時提供起迄則驗證視窗。回傳可直接交給 Prisma update 的 patch。 */
export interface ProjectPatch {
  name?: string;
  client?: string;
  ownerId?: string;
  planStart?: Date;
  planEnd?: Date;
}

export function buildProjectPatch(
  input: ProjectDraftInput,
  current: { planStart: Date; planEnd: Date },
): ProjectPatch {
  const patch: ProjectPatch = {};
  if (input.name !== undefined) {
    const name = (input.name ?? '').trim();
    if (!name) throw new ProjectEngineError('name_required', '專案名稱不可為空');
    patch.name = name;
  }
  if (input.client !== undefined) {
    const client = (input.client ?? '').trim();
    if (!client) throw new ProjectEngineError('client_required', '客戶名稱不可為空');
    patch.client = client;
  }
  if (input.ownerId !== undefined) {
    const ownerId = (input.ownerId ?? '').trim();
    if (!ownerId) throw new ProjectEngineError('owner_required', '專案負責人不可為空');
    patch.ownerId = ownerId;
  }
  if (input.planStart !== undefined && input.planStart !== null) {
    patch.planStart = parseDate(input.planStart, 'planStart');
  }
  if (input.planEnd !== undefined && input.planEnd !== null) {
    patch.planEnd = parseDate(input.planEnd, 'planEnd');
  }
  const start = patch.planStart ?? current.planStart;
  const end = patch.planEnd ?? current.planEnd;
  if (end.getTime() < start.getTime()) {
    throw new ProjectEngineError('invalid_plan_window', 'planEnd 不可早於 planStart');
  }
  return patch;
}

/**
 * 專案狀態機（規格 §3.1 status：進行中／已完成／暫停／取消）。
 * - ACTIVE → ON_HOLD / COMPLETED / CANCELLED
 * - ON_HOLD → ACTIVE / COMPLETED / CANCELLED
 * - COMPLETED / CANCELLED 為終態（無出邊）。
 */
const PROJECT_TRANSITIONS: Readonly<Record<ProjectStatus, readonly ProjectStatus[]>> = Object.freeze({
  [ProjectStatus.ACTIVE]: [ProjectStatus.ON_HOLD, ProjectStatus.COMPLETED, ProjectStatus.CANCELLED],
  [ProjectStatus.ON_HOLD]: [ProjectStatus.ACTIVE, ProjectStatus.COMPLETED, ProjectStatus.CANCELLED],
  [ProjectStatus.COMPLETED]: [],
  [ProjectStatus.CANCELLED]: [],
});

export function canTransitionStatus(from: ProjectStatus, to: ProjectStatus): boolean {
  if (from === to) return true; // 冪等：維持原狀態視為合法（不變更）
  return PROJECT_TRANSITIONS[from].includes(to);
}

export function assertStatusTransition(from: ProjectStatus, to: ProjectStatus): ProjectStatus {
  if (!canTransitionStatus(from, to)) {
    throw new ProjectEngineError('invalid_status_transition', `專案狀態不可由 ${from} 轉為 ${to}`);
  }
  return to;
}

/** 掛載流程輸入（原始）。 */
export interface FlowMountInput {
  caseId?: string | null;
  flowType?: FlowType | null;
  name?: string | null;
  planStart?: Date | string | null;
  planEnd?: Date | string | null;
  progress?: number | null;
}

/** 已正規化的掛載流程資料。 */
export interface NormalizedFlowMount {
  caseId: string | null;
  flowType: FlowType;
  name: string;
  planStart: Date;
  planEnd: Date;
  progress: number;
}

/** 限制進度為 0..100 的整數。 */
export function normalizeProgress(value: number | null | undefined): number {
  if (value == null) return 0;
  if (!Number.isFinite(value)) {
    throw new ProjectEngineError('invalid_progress', `progress 不是合法數值：${String(value)}`);
  }
  const n = Math.round(value);
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

/**
 * 驗證並正規化掛載流程。允許各流程計畫期間先後與重疊（規格 §3.2 備註）——
 * 故僅驗證單一流程自身視窗（planEnd >= planStart），不檢查與其他流程是否重疊。
 *
 * 若提供 caseFallback（由案件帶出的 flowType / 顯示名稱），可在未明指時沿用。
 */
export function buildFlowMount(
  input: FlowMountInput,
  caseFallback?: { flowType?: FlowType | null; name?: string | null },
): NormalizedFlowMount {
  const flowType = input.flowType ?? caseFallback?.flowType ?? null;
  if (!flowType) throw new ProjectEngineError('flow_type_required', '流程類型必填（或由案件帶出）');

  const name = (input.name ?? caseFallback?.name ?? '').trim();
  if (!name) throw new ProjectEngineError('flow_name_required', '流程顯示名稱必填（或由案件帶出）');

  if (input.planStart == null) throw new ProjectEngineError('invalid_date', '流程 planStart 必填');
  if (input.planEnd == null) throw new ProjectEngineError('invalid_date', '流程 planEnd 必填');
  const planStart = parseDate(input.planStart, 'planStart');
  const planEnd = parseDate(input.planEnd, 'planEnd');
  if (planEnd.getTime() < planStart.getTime()) {
    throw new ProjectEngineError('invalid_plan_window', '流程 planEnd 不可早於 planStart');
  }

  return {
    caseId: (input.caseId ?? '').trim() || null,
    flowType,
    name,
    planStart,
    planEnd,
    progress: normalizeProgress(input.progress),
  };
}

/** 判斷兩個計畫區間是否重疊（含端點）。供 UI 標示用，不阻擋掛載。 */
export function flowsOverlap(
  a: { planStart: Date; planEnd: Date },
  b: { planStart: Date; planEnd: Date },
): boolean {
  return a.planStart.getTime() <= b.planEnd.getTime() && b.planStart.getTime() <= a.planEnd.getTime();
}

/**
 * 由步驟實例狀態計算「步驟完成比例」（規格 §4.1 預設建議）。
 * 完成比例 = 已完成步驟數 ÷ 計入步驟數（排除 SKIPPED）；無計入步驟回 0。
 */
export interface StepStatusLike {
  status: string; // StepInstanceStatus 字串（PENDING/IN_PROGRESS/COMPLETED/SKIPPED/RETURNED）
}

export function computeStepCompletionProgress(steps: readonly StepStatusLike[]): number {
  const counted = steps.filter((s) => s.status !== 'SKIPPED');
  if (counted.length === 0) return 0;
  const done = counted.filter((s) => s.status === 'COMPLETED').length;
  return normalizeProgress((done / counted.length) * 100);
}

/** 專案整體進度 = 各流程 progress 的平均（無流程回 0），供主畫面 KPI（規格 §5.1）。 */
export function averageProgress(flows: readonly { progress: number }[]): number {
  if (flows.length === 0) return 0;
  const sum = flows.reduce((acc, f) => acc + f.progress, 0);
  return normalizeProgress(sum / flows.length);
}
