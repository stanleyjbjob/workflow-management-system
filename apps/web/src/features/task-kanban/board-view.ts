/**
 * 任務看板呈現純邏輯（§8 / issue 6.1）。不依賴 DOM/React，可純函式測試。
 * 後端已完成分欄/標示/KPI；本檔僅提供「呈現對應」與「檢視層客端過濾」（seed 驅動時於前端再篩選；
 * REST 就緒後改以查詢參數交後端過濾，本檔過濾仍可用於即時 UI 反應）。
 */
import {
  KANBAN_COLUMN_ORDER,
  type KanbanBoard,
  type KanbanCard,
  type KanbanColumn,
  type KanbanKpi,
} from './types';

/** 角色選項（對應 RoleCode）。 */
export const ROLE_OPTIONS: readonly { code: string; label: string }[] = [
  { code: 'MANAGER', label: '部門主管' },
  { code: 'SALES', label: '業務' },
  { code: 'CONSULTANT', label: '顧問' },
  { code: 'ENG_LEAD', label: '工程主管' },
  { code: 'ENGINEER', label: '工程師' },
  { code: 'ASSISTANT', label: '助理' },
];

/** 分欄外觀（標題色）。 */
export const COLUMN_ACCENT: Readonly<Record<KanbanColumn, string>> = {
  TODO: '#64748b',
  IN_PROGRESS: '#2563eb',
  UPCOMING: '#d97706',
  DONE: '#16a34a',
};

/** 卡片標記類別。 */
export type BadgeKind = 'overdue' | 'dueSoon' | 'deferred' | 'forms';

export interface CardBadge {
  kind: BadgeKind;
  label: string;
  color: string;
  bg: string;
}

/** 由卡片推導要顯示的標記（逾期 / 即將到期 / 遞延 / 待填表單）。 */
export function cardBadges(card: KanbanCard): CardBadge[] {
  const out: CardBadge[] = [];
  if (card.overdue) {
    const n = card.daysUntilDue != null ? Math.abs(card.daysUntilDue) : 0;
    out.push({ kind: 'overdue', label: `逾期 ${n} 天`, color: '#b91c1c', bg: '#fee2e2' });
  } else if (card.dueSoon) {
    const n = card.workdaysUntilDue != null ? card.workdaysUntilDue : card.daysUntilDue;
    out.push({ kind: 'dueSoon', label: n != null ? `${n} 工作日內到期` : '即將到期', color: '#b45309', bg: '#fef3c7' });
  }
  if (card.deferred) {
    out.push({ kind: 'deferred', label: `遇假日遞延 ${card.deferredDays} 天`, color: '#7c3aed', bg: '#ede9fe' });
  }
  if (card.pendingRequiredForms > 0) {
    out.push({ kind: 'forms', label: `待填表單 ${card.pendingRequiredForms}`, color: '#0369a1', bg: '#e0f2fe' });
  }
  return out;
}

/** 重新彙總 KPI（客端過濾後）。僅就 actionable 卡片計。 */
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

/** 客端過濾選項。 */
export interface ClientFilter {
  /** 僅看此角色負責（responsibleRoleCode）。 */
  role?: string | null;
  /** 僅看此流程型別。 */
  flowType?: string | null;
}

/** 對看板套用客端過濾（跨欄濾卡並重算 KPI / 計數）。 */
export function filterBoard(board: KanbanBoard, filter: ClientFilter = {}): KanbanBoard {
  const role = filter.role ?? null;
  const flowType = filter.flowType ?? null;
  const keep = (c: KanbanCard): boolean => {
    if (role != null && c.responsibleRoleCode !== role) return false;
    if (flowType != null && c.flowType !== flowType) return false;
    return true;
  };
  const columns = {} as Record<KanbanColumn, KanbanCard[]>;
  const all: KanbanCard[] = [];
  for (const col of KANBAN_COLUMN_ORDER) {
    const kept = (board.columns[col] ?? []).filter(keep);
    columns[col] = kept;
    for (const c of kept) all.push(c);
  }
  const kpi = summarizeKpi(all);
  return { order: KANBAN_COLUMN_ORDER, columns, kpi, total: all.length, activeTotal: kpi.pending };
}

/** 取所有流程型別（供過濾下拉）。 */
export function flowTypesIn(board: KanbanBoard): string[] {
  const set = new Set<string>();
  for (const col of KANBAN_COLUMN_ORDER) {
    for (const c of board.columns[col] ?? []) {
      if (c.flowType) set.add(c.flowType);
    }
  }
  return [...set].sort();
}

/* ───────────── 伺服端過濾（issue 8.9 #44）：UI 過濾器 ↔ GET /kanban query 參數 ───────────── */

/** 流程型別固定選項（與後端 FlowType 對齊；下拉永遠完整，不因當前結果縮水）。 */
export const FLOW_OPTIONS: readonly { code: string; label: string }[] = [
  { code: 'SALES', label: '銷售' },
  { code: 'ONBOARDING', label: '導入' },
  { code: 'ENVIRONMENT', label: '環境建置' },
  { code: 'CUSTOMIZATION', label: '客製化' },
];

/** 「即將到期」視窗可選值（工作日；後端預設 3）。 */
export const UPCOMING_WINDOW_OPTIONS: readonly number[] = [3, 5, 7, 10];

/** 看板 UI 過濾器狀態（受控；變更即重新向後端查詢）。 */
export interface KanbanFilterState {
  /** 責任角色（RoleCode）；空字串＝全部。 */
  role: string;
  /** 流程型別；空字串＝全部。 */
  flowType: string;
  /** 僅看與我相關（指派給我或我角色負責）。 */
  onlyMine: boolean;
  /** 「即將到期」視窗（工作日）；null＝後端預設（3）。 */
  upcomingWithinDays: number | null;
}

/** 預設過濾器（不過濾、視窗用後端預設）。 */
export const DEFAULT_KANBAN_FILTER: KanbanFilterState = {
  role: '',
  flowType: '',
  onlyMine: false,
  upcomingWithinDays: null,
};

/** UI 過濾器 → GET /kanban 查詢參數（純函式；空值不送、視窗等於預設 3 時亦不送）。 */
export function toKanbanQuery(f: KanbanFilterState): {
  role?: string | null;
  flowType?: string | null;
  onlyMine?: boolean;
  upcomingWithinDays?: number | null;
} {
  return {
    role: f.role || null,
    flowType: f.flowType || null,
    onlyMine: f.onlyMine,
    upcomingWithinDays: f.upcomingWithinDays != null && f.upcomingWithinDays !== 3 ? f.upcomingWithinDays : null,
  };
}

/** 流程下拉選項：固定選項 ∪ 當前看板出現之未知型別（防後端新增型別時前端漏列）。 */
export function mergeFlowOptions(board: KanbanBoard): { code: string; label: string }[] {
  const known = new Set(FLOW_OPTIONS.map((o) => o.code));
  const extras = flowTypesIn(board).filter((t) => !known.has(t));
  return [...FLOW_OPTIONS, ...extras.map((code) => ({ code, label: code }))];
}
