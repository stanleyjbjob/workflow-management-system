/**
 * 任務看板頁（issue 8.2 #34）：由 REST `GET /kanban` 取得真實看板資料（非 seed），
 * 處理載入 / 錯誤（401 未登入、403 權限不足、0 連線失敗）狀態，
 * 成功後交給 TaskKanbanView 呈現；onOpenCase 由上層決定導向（後續串案件詳情頁）。
 *
 * 載入 / 錯誤狀態改用共用元件（issue 8.4 #39，全站一致；401 已由 client 統一導向 SSO）。
 */
import { useCallback, useEffect, useState } from 'react';
import { ErrorState, LoadingState, toErrorState, type NormalizedError } from '../../components/AsyncStates';
import { fetchKanbanBoard } from './api';
import { TaskKanbanView } from './TaskKanbanView';
import type { KanbanBoard } from './types';

export interface TaskKanbanPageProps {
  /** 點卡片「前往案件」時呼叫（提供 caseId）；未提供則僅顯示側欄詳情。 */
  onOpenCase?: (caseId: string) => void;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; board: KanbanBoard }
  | { kind: 'error'; error: NormalizedError };

export function TaskKanbanPage({ onOpenCase }: TaskKanbanPageProps): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const load = useCallback((): void => {
    setState({ kind: 'loading' });
    fetchKanbanBoard()
      .then((board) => setState({ kind: 'ready', board }))
      .catch((err: unknown) => setState({ kind: 'error', error: toErrorState(err) }));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (state.kind === 'loading') return <LoadingState label="看板載入中…" />;
  if (state.kind === 'error') return <ErrorState title="看板載入失敗" error={state.error} onRetry={load} />;
  return <TaskKanbanView board={state.board} onOpenCase={onOpenCase} />;
}
