/**
 * 任務看板頁（issue 8.2 #34）：由 REST `GET /kanban` 取得真實看板資料（非 seed），
 * 處理載入 / 錯誤（401 未登入、403 權限不足、0 連線失敗）狀態，
 * 成功後交給 TaskKanbanView 呈現；onOpenCase 由上層決定導向（後續串案件詳情頁）。
 */
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
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
  | { kind: 'error'; status: number; code: string; message: string };

function errorHint(status: number): string | null {
  if (status === 401) return '尚未登入：請先完成 Microsoft 365 SSO 登入後再開啟看板。';
  if (status === 403) return '權限不足：目前帳號無 case:read 權限，請聯繫主管調整角色。';
  if (status === 0) return '無法連線後端 API：請確認 apps/api 服務已啟動（預設 http://localhost:3000）。';
  return null;
}

export function TaskKanbanPage({ onOpenCase }: TaskKanbanPageProps): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const load = useCallback((): void => {
    setState({ kind: 'loading' });
    fetchKanbanBoard()
      .then((board) => setState({ kind: 'ready', board }))
      .catch((err: unknown) => {
        if (err instanceof ApiError) {
          setState({ kind: 'error', status: err.status, code: err.code, message: err.message });
        } else {
          setState({ kind: 'error', status: -1, code: 'unknown', message: String(err) });
        }
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (state.kind === 'loading') {
    return (
      <section>
        <p className="muted">看板載入中…</p>
      </section>
    );
  }

  if (state.kind === 'error') {
    const hint = errorHint(state.status);
    return (
      <section>
        <p style={{ color: '#b91c1c', fontWeight: 600 }}>看板載入失敗（{state.code}）</p>
        <p className="muted" style={{ fontSize: '12.5px' }}>
          {state.message}
        </p>
        {hint && (
          <p className="muted" style={{ fontSize: '12.5px' }}>
            {hint}
          </p>
        )}
        <button className="btn primary" onClick={load}>
          重試
        </button>
      </section>
    );
  }

  return <TaskKanbanView board={state.board} onOpenCase={onOpenCase} />;
}
