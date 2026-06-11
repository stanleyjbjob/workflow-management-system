/**
 * 任務看板頁（issue 8.2 #34；8.9 #44 完成伺服端過濾串接）：
 * 由 REST `GET /kanban` 取得真實看板資料（非 seed）；UI 過濾器（角色 / 流程 / 僅看與我相關 /
 * 到期視窗）對應 query 參數，變更即重新向後端查詢——分欄、標示與 KPI 一律以後端結果為準。
 * 重新查詢期間保留現有看板（淡化呈現），以遞增序號防止過時回應覆蓋較新結果。
 * 處理載入 / 錯誤（401 未登入、403 權限不足、0 連線失敗）/ 空狀態（依 8.4 慣例）。
 * onOpenCase 由上層決定導向（8.12 案件詳情頁串接後帶 caseId 導頁）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorState, LoadingState, toErrorState, type NormalizedError } from '../../components/AsyncStates';
import { fetchKanbanBoard } from './api';
import { DEFAULT_KANBAN_FILTER, toKanbanQuery, type KanbanFilterState } from './board-view';
import { TaskKanbanView } from './TaskKanbanView';
import type { KanbanBoard } from './types';

export interface TaskKanbanPageProps {
  /** 點卡片「前往案件」時呼叫（提供 caseId）；未提供則僅顯示側欄詳情。 */
  onOpenCase?: (caseId: string) => void;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; board: KanbanBoard; refreshing: boolean }
  | { kind: 'error'; error: NormalizedError };

export function TaskKanbanPage({ onOpenCase }: TaskKanbanPageProps): JSX.Element {
  const [filter, setFilter] = useState<KanbanFilterState>(DEFAULT_KANBAN_FILTER);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  /** 遞增請求序號：僅最新請求的回應可落地（防快速切換過濾器時過時回應覆蓋）。 */
  const seqRef = useRef(0);

  const load = useCallback((f: KanbanFilterState): void => {
    const seq = ++seqRef.current;
    setState((prev) => (prev.kind === 'ready' ? { ...prev, refreshing: true } : { kind: 'loading' }));
    fetchKanbanBoard(toKanbanQuery(f))
      .then((board) => {
        if (seqRef.current !== seq) return;
        setState({ kind: 'ready', board, refreshing: false });
      })
      .catch((err: unknown) => {
        if (seqRef.current !== seq) return;
        setState({ kind: 'error', error: toErrorState(err) });
      });
  }, []);

  useEffect(() => {
    load(filter);
  }, [load, filter]);

  if (state.kind === 'loading') return <LoadingState label="看板載入中…" />;
  if (state.kind === 'error') return <ErrorState title="看板載入失敗" error={state.error} onRetry={() => load(filter)} />;
  return (
    <TaskKanbanView
      board={state.board}
      filter={filter}
      onFilterChange={setFilter}
      refreshing={state.refreshing}
      onOpenCase={onOpenCase}
    />
  );
}
