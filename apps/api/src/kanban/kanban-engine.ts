import { FlowType, RoleCode, StepInstanceStatus } from '@prisma/client';

/**
 * 任務看板引擎核心（純領域邏輯，無 DB / Nest 相依）。
 *
 * 對應需求規格 §8 任務看板 / 待辦（issue 6.1），以「角色視角」呈現待辦、待填表單與到期提醒：
 * - 依角色 / 承辦人過濾任務（§8.5 可見範圍由 Service 以 AccessScope 先行收斂，本引擎再做檢視層過濾）。
 * - 看板分欄：待辦（TODO）/ 進行中（IN_PROGRESS）/ 即將到期（UPCOMING）/ 已完成（DONE）。
 * - 標示：到期（dueSoon）/ 逾期（overdue）/ 受連假遞延（deferred）。
 * - KPI：待處理 / 即將到期 / 逾期 / 遞延。
 *
 * 設計沿用 workflow / forms / templates / sales / onboarding / environment / customization /
 * calendar / delay 引擎之「純引擎 + Service」風格：本檔僅負責「分類 / 標示 / 統計」決策，
 * 不接觸資料庫，可被純函式單元測試完整覆蓋。KanbanService 再以 Prisma 載入步驟實例、
 * 以 AccessScopeService 收斂可見範圍、以 CalendarService（calendar-engine）計算遞延後，
 * 組出 KanbanTaskInput[] 餵入本引擎。
 *
 * 「遞延」與行事曆解耦（與 delay-engine 注入 workdayCounter 的策略一致）：本引擎不直接相依
 * calendar-engine，而是接受每筆任務的 deferred / deferredDays 輸入，或於選項注入
 * deferralResolver(dueDate) 由 Service 以行事曆實作。
 *
 * 日界一律以 UTC 判斷（與 calendar-engine / gantt-engine / delay-engine 一致），避免執行環境
 * 時區造成跨日誤差。
 */

export type KanbanEngineErrorCode =
  | 'invalid_due_date'
  | 'invalid_now'
  | 'invalid_window';

/** 引擎錯誤；以 code 表示原因，方便上層轉成對應 HTTP 例外或訊息。 */
export class KanbanEngineError extends Error {
  constructor(
    public readonly code: KanbanEngineErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'KanbanEngineError';
  }
}

/** 看板分欄。 */
export type KanbanColumn = 'TODO' | 'IN_PROGRESS' | 'UPCOMING' | 'DONE';

/** 分欄固定顯示順序（待辦 → 進行中 → 即將到期 → 已完成）。 */
export const KANBAN_COLUMN_ORDER: readonly KanbanColumn[] = Object.freeze([
  'TODO',
  'IN_PROGRESS',
  'UPCOMING',
  'DONE',
]);

/** 分欄中文標籤（供 UI / 報表）。 */
export const KANBAN_COLUMN_LABELS: Readonly<Record<KanbanColumn, string>> = Object.freeze({
  TODO: '待辦',
  IN_PROGRESS: '進行中',
  UPCOMING: '即將到期',
  DONE: '已完成',
});

/** 到期狀態。 */
export type DueState = 'NONE' | 'UPCOMING' | 'OVERDUE';

/** 視為「進行中（actionable）」的步驟實例狀態：待辦 + 進行中。 */
export const ACTIVE_STEP_STATUSES: readonly StepInstanceStatus[] = Object.freeze([
  StepInstanceStatus.PENDING,
  StepInstanceStatus.IN_PROGRESS,
]);

/** 預設「即將到期」視窗（曆日）：到期日距今 0..N 天（含當日、未逾期）視為即將到期。 */
export const DEFAULT_UPCOMING_WITHIN_DAYS = 3;

/**
 * 單一任務輸入（對齊 Prisma StepInstance + 其 Case / StepDefinition，但以結構型別解耦）。
 * 一張任務卡＝一筆步驟實例。
 */
export interface KanbanTaskInput {
  stepInstanceId: string;
  caseId: string;
  caseCode?: string | null;
  caseTitle?: string | null;
  clientName?: string | null;
  flowType?: FlowType | string | null;
  stepDefinitionId?: string | null;
  stepName?: string | null;
  stepOrder?: number | null;
  status: StepInstanceStatus;
  /** 步驟負責角色（流程定義）之 id。 */
  responsibleRoleId?: string | null;
  /** 步驟負責角色之 code（供角色檢視過濾）。 */
  responsibleRoleCode?: RoleCode | string | null;
  /** 承辦人 id。 */
  assigneeId?: string | null;
  /** 到期日；null 表示未排定。 */
  dueDate?: Date | string | null;
  /** 待填必填表單數（供「待填表單」呈現）；未提供視為 0。 */
  pendingRequiredForms?: number | null;
  /** 行事曆遞延：此到期日是否因假日 / 連假被遞延（由 Service 以行事曆計算或注入）。 */
  deferred?: boolean | null;
  /** 遞延天數（>= 0）；未提供時若 deferred 為真則視為 1。 */
  deferredDays?: number | null;
  /** 原始（未遞延）到期日，供呈現對照。 */
  originalDueDate?: Date | string | null;
}

/** 檢視者（由 Service 自 SessionUser 萃取）。 */
export interface KanbanViewer {
  userId?: string | null;
  roleCodes?: readonly string[];
  isManager?: boolean;
}

/** 檢視層過濾條件（在 Service 的可見範圍之上再做篩選）。 */
export interface KanbanFilter {
  /** 僅看此角色負責的任務（比對 responsibleRoleCode）。 */
  roleCode?: string | null;
  /** 僅看指派給此人的任務（比對 assigneeId）。 */
  assigneeId?: string | null;
  /** 僅看此流程型別。 */
  flowType?: string | null;
  /** 僅看「與我相關」：指派給我，或我任一角色負責。需搭配 viewer。 */
  onlyMine?: boolean;
}

/** 遞延解析器：給定到期日，回報是否遞延與遞延天數（由 Service 以 calendar-engine 實作）。 */
export type DeferralResolver = (dueDate: Date) => { deferred: boolean; deferredDays?: number };

/** 看板計算選項。 */
export interface KanbanOptions {
  /** 評估基準時間（今日），預設 new Date()。 */
  now?: Date | string;
  /** 「即將到期」視窗天數（曆日，>= 0），預設 3。 */
  upcomingWithinDays?: number;
  /** 遞延解析器；提供時，未明確標記 deferred 的任務將以此計算。 */
  deferralResolver?: DeferralResolver;
}

/** 對外的任務卡（標準化後）。 */
export interface KanbanCard {
  stepInstanceId: string;
  caseId: string;
  caseCode: string | null;
  caseTitle: string | null;
  clientName: string | null;
  flowType: string | null;
  stepDefinitionId: string | null;
  stepName: string | null;
  stepOrder: number | null;
  status: StepInstanceStatus;
  responsibleRoleId: string | null;
  responsibleRoleCode: string | null;
  assigneeId: string | null;
  /** 到期日 ISO（yyyy-mm-dd）或 null。 */
  dueDate: string | null;
  pendingRequiredForms: number;
  /** 是否為 actionable（待辦 / 進行中）。 */
  isActive: boolean;
  /** 所屬分欄。 */
  column: KanbanColumn;
  /** 到期狀態。 */
  dueState: DueState;
  /** 距到期之曆日數（負值＝已逾期）；無到期日為 null。 */
  daysUntilDue: number | null;
  /** 即將到期標示（actionable 且到期日在視窗內、未逾期）。 */
  dueSoon: boolean;
  /** 逾期標示（actionable 且到期日早於今日）。 */
  overdue: boolean;
  /** 受連假 / 假日遞延標示。 */
  deferred: boolean;
  /** 遞延天數。 */
  deferredDays: number;
}

/** KPI（§8 看板上方統計）。 */
export interface KanbanKpi {
  /** 待處理：所有 actionable（待辦 + 進行中）任務數。 */
  pending: number;
  /** 即將到期。 */
  upcoming: number;
  /** 逾期。 */
  overdue: number;
  /** 遞延。 */
  deferred: number;
}

/** 看板整體呈現。 */
export interface KanbanBoard {
  order: readonly KanbanColumn[];
  columns: Record<KanbanColumn, KanbanCard[]>;
  kpi: KanbanKpi;
  /** 過濾後卡片總數。 */
  total: number;
  /** actionable 卡片數（= kpi.pending）。 */
  activeTotal: number;
}

/* ────────────────────────── 日期工具（UTC） ────────────────────────── */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 解析 Date / ISO 字串為 Date；null / undefined 回 null；非法拋對應錯誤。 */
function parseDateOrNull(value: Date | string | null | undefined, code: KanbanEngineErrorCode): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new KanbanEngineError(code, `非法日期：${String(value)}`);
  }
  return d;
}

/** 取 UTC 當日 0 時 epoch ms。 */
function startOfUtcDayMs(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** 兩日期相差幾個曆日（b - a，依 UTC 日界）。 */
export function calendarDaysBetween(a: Date, b: Date): number {
  return Math.round((startOfUtcDayMs(b) - startOfUtcDayMs(a)) / MS_PER_DAY);
}

/** 轉 yyyy-mm-dd（UTC）。 */
function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ────────────────────────── 判斷工具 ────────────────────────── */

/** 該步驟狀態是否為 actionable（待辦 / 進行中）。 */
export function isActiveStatus(status: StepInstanceStatus): boolean {
  return ACTIVE_STEP_STATUSES.includes(status);
}

/**
 * 計算到期狀態（僅對 actionable 任務有意義）。
 * - 無到期日 / 非 actionable → NONE。
 * - daysUntilDue < 0 → OVERDUE（逾期）。
 * - 0 <= daysUntilDue <= window → UPCOMING（即將到期）。
 * - 其餘（遠期）→ NONE。
 */
export function classifyDue(
  status: StepInstanceStatus,
  dueDate: Date | null,
  now: Date,
  windowDays: number,
): { dueState: DueState; daysUntilDue: number | null } {
  if (!isActiveStatus(status) || dueDate == null) {
    return { dueState: 'NONE', daysUntilDue: dueDate == null ? null : calendarDaysBetween(now, dueDate) };
  }
  const days = calendarDaysBetween(now, dueDate);
  if (days < 0) return { dueState: 'OVERDUE', daysUntilDue: days };
  if (days <= windowDays) return { dueState: 'UPCOMING', daysUntilDue: days };
  return { dueState: 'NONE', daysUntilDue: days };
}

/**
 * 決定卡片所屬分欄（互斥）。優先序：
 *  1. 已完成（COMPLETED）→ DONE。
 *  2. actionable 且即將到期（dueState=UPCOMING）→ UPCOMING（聚焦欄；逾期不在此欄，逾期以 marker 呈現於原狀態欄）。
 *  3. actionable 且 IN_PROGRESS → IN_PROGRESS。
 *  4. actionable（PENDING）→ TODO。
 * 註：SKIPPED / RETURNED 等非 actionable 且非完成之狀態不落在任何看板欄（由 buildBoard 過濾）。
 */
export function columnOf(status: StepInstanceStatus, dueState: DueState): KanbanColumn {
  if (status === StepInstanceStatus.COMPLETED) return 'DONE';
  if (dueState === 'UPCOMING') return 'UPCOMING';
  if (status === StepInstanceStatus.IN_PROGRESS) return 'IN_PROGRESS';
  return 'TODO';
}

/** 角色檢視比對：任務之 responsibleRoleCode 是否等於指定角色。 */
export function roleMatches(task: KanbanTaskInput, roleCode: string): boolean {
  return (task.responsibleRoleCode ?? null) === roleCode;
}

/**
 * 是否為某檢視者「與我相關」的任務：指派給我，或我任一角色負責該步驟。
 * 主管（isManager）視為與全部相關。
 */
export function isMine(task: KanbanTaskInput, viewer: KanbanViewer): boolean {
  if (viewer.isManager) return true;
  if (viewer.userId && task.assigneeId && task.assigneeId === viewer.userId) return true;
  const roles = viewer.roleCodes ?? [];
  const code = task.responsibleRoleCode ?? null;
  return code != null && roles.includes(code);
}

/**
 * 套用檢視層過濾（在 Service 的可見範圍之上）。
 * 全部條件以 AND 結合；未提供之條件不過濾。
 */
export function matchesFilter(
  task: KanbanTaskInput,
  filter: KanbanFilter | undefined,
  viewer: KanbanViewer | undefined,
): boolean {
  if (!filter) return true;
  if (filter.roleCode != null && !roleMatches(task, filter.roleCode)) return false;
  if (filter.assigneeId != null && (task.assigneeId ?? null) !== filter.assigneeId) return false;
  if (filter.flowType != null && (task.flowType ?? null) !== filter.flowType) return false;
  if (filter.onlyMine) {
    if (!isMine(task, viewer ?? {})) return false;
  }
  return true;
}

/* ────────────────────────── 遞延 ────────────────────────── */

/**
 * 解析單筆任務的遞延資訊。
 * 優先採用任務上已標記之 deferred；否則若提供 resolver 且有到期日，以 resolver 計算。
 * deferredDays 規則：明確提供則用之（夾為非負整數）；deferred 為真但未提供天數則視為 1。
 */
export function resolveTaskDeferral(
  task: KanbanTaskInput,
  dueDate: Date | null,
  resolver?: DeferralResolver,
): { deferred: boolean; deferredDays: number } {
  let deferred = task.deferred === true;
  let days = normalizeDays(task.deferredDays);

  if (task.deferred == null && resolver && dueDate != null) {
    const r = resolver(dueDate);
    deferred = r.deferred === true;
    days = normalizeDays(r.deferredDays);
  }

  if (deferred && days <= 0) days = 1;
  if (!deferred) days = 0;
  return { deferred, deferredDays: days };
}

function normalizeDays(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0;
  const r = Math.round(n);
  return r < 0 ? 0 : r;
}

/* ────────────────────────── 建卡 / 建板 ────────────────────────── */

/** 將單筆任務輸入轉為標準化卡片（含分欄與標示）。 */
export function buildCard(task: KanbanTaskInput, options: KanbanOptions = {}): KanbanCard {
  const now = parseDateOrNull(options.now ?? new Date(), 'invalid_now') as Date;
  const windowDays = normalizeWindow(options.upcomingWithinDays);
  const dueDate = parseDateOrNull(task.dueDate, 'invalid_due_date');

  const { dueState, daysUntilDue } = classifyDue(task.status, dueDate, now, windowDays);
  const active = isActiveStatus(task.status);
  const { deferred, deferredDays } = resolveTaskDeferral(task, dueDate, options.deferralResolver);

  return {
    stepInstanceId: task.stepInstanceId,
    caseId: task.caseId,
    caseCode: task.caseCode ?? null,
    caseTitle: task.caseTitle ?? null,
    clientName: task.clientName ?? null,
    flowType: task.flowType != null ? String(task.flowType) : null,
    stepDefinitionId: task.stepDefinitionId ?? null,
    stepName: task.stepName ?? null,
    stepOrder: task.stepOrder ?? null,
    status: task.status,
    responsibleRoleId: task.responsibleRoleId ?? null,
    responsibleRoleCode: task.responsibleRoleCode != null ? String(task.responsibleRoleCode) : null,
    assigneeId: task.assigneeId ?? null,
    dueDate: dueDate != null ? toIsoDate(dueDate) : null,
    pendingRequiredForms: normalizeDays(task.pendingRequiredForms),
    isActive: active,
    column: columnOf(task.status, dueState),
    dueState,
    daysUntilDue,
    dueSoon: dueState === 'UPCOMING',
    overdue: dueState === 'OVERDUE',
    deferred,
    deferredDays,
  };
}

function normalizeWindow(n: number | null | undefined): number {
  if (n == null) return DEFAULT_UPCOMING_WITHIN_DAYS;
  if (!Number.isInteger(n) || n < 0) {
    throw new KanbanEngineError('invalid_window', `即將到期視窗天數須為非負整數：${String(n)}`);
  }
  return n;
}

/** 空看板（各欄空陣列）。 */
function emptyColumns(): Record<KanbanColumn, KanbanCard[]> {
  return { TODO: [], IN_PROGRESS: [], UPCOMING: [], DONE: [] };
}

/**
 * 由 actionable / 完成卡片彙總 KPI。
 * - pending（待處理）= actionable 卡片數。
 * - upcoming / overdue / deferred 僅就 actionable 卡片計（已完成不計入待辦壓力）。
 */
export function summarizeKpi(cards: readonly KanbanCard[]): KanbanKpi {
  let pending = 0;
  let upcoming = 0;
  let overdue = 0;
  let deferred = 0;
  for (const c of cards) {
    if (!c.isActive) continue;
    pending += 1;
    if (c.dueSoon) upcoming += 1;
    if (c.overdue) overdue += 1;
    if (c.deferred) deferred += 1;
  }
  return { pending, upcoming, overdue, deferred };
}

/** 看板建構參數。 */
export interface BuildBoardParams {
  viewer?: KanbanViewer;
  filter?: KanbanFilter;
  options?: KanbanOptions;
}

/**
 * 由任務清單建構看板。
 * 步驟：過濾（matchesFilter）→ 建卡（buildCard）→ 丟棄非 actionable 且非完成之卡片（SKIPPED / RETURNED）
 *      → 依分欄歸位 → 各欄排序（到期日早者在前，無到期日在後，再以 stepOrder / caseCode 穩定排序）
 *      → 彙總 KPI。
 */
export function buildBoard(tasks: readonly KanbanTaskInput[], params: BuildBoardParams = {}): KanbanBoard {
  const { viewer, filter, options } = params;
  const columns = emptyColumns();
  const kept: KanbanCard[] = [];

  for (const t of tasks) {
    if (!matchesFilter(t, filter, viewer)) continue;
    const card = buildCard(t, options);
    // 僅 actionable 或已完成的卡片進入看板；SKIPPED / RETURNED 不呈現。
    if (!card.isActive && card.status !== StepInstanceStatus.COMPLETED) continue;
    kept.push(card);
    columns[card.column].push(card);
  }

  for (const col of KANBAN_COLUMN_ORDER) {
    columns[col].sort(compareCards);
  }

  const kpi = summarizeKpi(kept);
  return {
    order: KANBAN_COLUMN_ORDER,
    columns,
    kpi,
    total: kept.length,
    activeTotal: kpi.pending,
  };
}

/** 卡片排序：到期日早者在前（null 在後）；同到期日依 stepOrder、再依 caseCode 穩定排序。 */
function compareCards(a: KanbanCard, b: KanbanCard): number {
  const ad = a.dueDate;
  const bd = b.dueDate;
  if (ad != null && bd != null) {
    if (ad !== bd) return ad < bd ? -1 : 1;
  } else if (ad != null) {
    return -1;
  } else if (bd != null) {
    return 1;
  }
  const ao = a.stepOrder ?? Number.MAX_SAFE_INTEGER;
  const bo = b.stepOrder ?? Number.MAX_SAFE_INTEGER;
  if (ao !== bo) return ao - bo;
  return (a.caseCode ?? '').localeCompare(b.caseCode ?? '');
}
