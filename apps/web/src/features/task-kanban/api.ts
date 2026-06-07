/**
 * 任務看板 REST 串接（issue 8.2 #34；後端 `GET /kanban`，issue 6.1 / 8.1）。
 * 查詢參數組裝（kanbanQuery）為純函式，可被 vitest 測試；
 * 後端已依登入者可見範圍收斂並完成分欄 / 標示 / KPI，前端取回即用。
 */
import { apiGet, buildQuery } from '../../lib/api';
import type { KanbanBoard } from './types';

/** `GET /kanban` 查詢參數（對應 kanban.controller.ts）。 */
export interface KanbanQuery {
  /** 僅看該角色（RoleCode）負責的任務。 */
  role?: string | null;
  /** 僅看指派給該使用者者。 */
  assignee?: string | null;
  /** 僅看該流程型別。 */
  flowType?: string | null;
  /** 僅看與我相關（指派給我或我角色負責）。 */
  onlyMine?: boolean;
  /** 覆寫「即將到期」視窗（工作日，後端預設 3）。 */
  upcomingWithinDays?: number | null;
}

/** 組 /kanban query string（純函式）。 */
export function kanbanQuery(q: KanbanQuery = {}): string {
  return buildQuery({
    role: q.role,
    assignee: q.assignee,
    flowType: q.flowType,
    onlyMine: q.onlyMine ? true : undefined,
    upcomingWithinDays: q.upcomingWithinDays,
  });
}

/** 取得任務看板（後端依 session 使用者收斂可見範圍）。 */
export function fetchKanbanBoard(q: KanbanQuery = {}): Promise<KanbanBoard> {
  return apiGet<KanbanBoard>(`/kanban${kanbanQuery(q)}`);
}
