/**
 * 任務看板呈現用型別（§8 / issue 6.1）。
 *
 * 為後端 `apps/api/src/kanban/kanban-engine.ts` 之 `KanbanBoard` 輸出結構的**前端鏡像**
 * （以結構複製、與後端型別解耦，與 project-gantt 同風格）。後端已完成分欄 / 標示 / KPI 計算，
 * 前端僅負責呈現與檢視層互動（角色過濾、點卡開案件）。
 *
 * 待 REST 層就緒後改以 fetch 取得相同結構即可；本輪先以 seed 範例資料驅動 UI。
 */

export type KanbanColumn = 'TODO' | 'IN_PROGRESS' | 'UPCOMING' | 'DONE';
export type DueState = 'NONE' | 'UPCOMING' | 'OVERDUE';

/** 分欄固定順序（與後端一致）。 */
export const KANBAN_COLUMN_ORDER: readonly KanbanColumn[] = ['TODO', 'IN_PROGRESS', 'UPCOMING', 'DONE'];

/** 分欄中文標籤。 */
export const KANBAN_COLUMN_LABELS: Readonly<Record<KanbanColumn, string>> = {
  TODO: '待辦',
  IN_PROGRESS: '進行中',
  UPCOMING: '即將到期',
  DONE: '已完成',
};

/** 任務卡（後端 KanbanCard 之前端鏡像）。 */
export interface KanbanCard {
  stepInstanceId: string;
  caseId: string;
  caseCode: string | null;
  caseTitle: string | null;
  clientName: string | null;
  flowType: string | null;
  stepName: string | null;
  stepOrder: number | null;
  status: string;
  responsibleRoleCode: string | null;
  assigneeId: string | null;
  dueDate: string | null;
  pendingRequiredForms: number;
  isActive: boolean;
  column: KanbanColumn;
  dueState: DueState;
  daysUntilDue: number | null;
  workdaysUntilDue: number | null;
  dueSoon: boolean;
  overdue: boolean;
  deferred: boolean;
  deferredDays: number;
}

/** KPI。 */
export interface KanbanKpi {
  pending: number;
  upcoming: number;
  overdue: number;
  deferred: number;
}

/** 看板（後端 KanbanBoard 之前端鏡像）。 */
export interface KanbanBoard {
  order: readonly KanbanColumn[];
  columns: Record<KanbanColumn, KanbanCard[]>;
  kpi: KanbanKpi;
  total: number;
  activeTotal: number;
}
