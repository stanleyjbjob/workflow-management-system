/**
 * 稽核軌跡頁容器（issue 8.3 #35）：由 REST 取得真實資料（非 seed），
 * 過濾條件改變後按「套用過濾」重新取數；處理載入 / 錯誤（401 未登入、403 權限不足、0 連線失敗）。
 * 成功後交給 IsoTrailView 呈現（與 TaskKanbanPage 同模式）。
 */
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import {
  EMPTY_TRAIL_FILTER,
  exportCsvUrl,
  exportJsonUrl,
  fetchTrail,
  fetchTrailSummary,
  filterToQuery,
  type TrailFilterState,
} from './api';
import { IsoTrailView } from './IsoTrailView';
import type { TraceabilityRecord, TrailSummary } from './types';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; records: TraceabilityRecord[]; summary: TrailSummary }
  | { kind: 'error'; status: number; code: string; message: string };

function errorHint(status: number): string | null {
  if (status === 401) return '尚未登入：請先完成 Microsoft 365 SSO 登入後再查閱稽核軌跡。';
  if (status === 403) return '權限不足：目前帳號無 case:read 權限，請聯繫主管調整角色。';
  if (status === 0) return '無法連線後端 API：請確認 apps/api 服務已啟動（預設 http://localhost:3000）。';
  return null;
}

export function IsoTrailPage(): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [filter, setFilter] = useState<TrailFilterState>(EMPTY_TRAIL_FILTER);

  const load = useCallback((f: TrailFilterState): void => {
    setState({ kind: 'loading' });
    const q = filterToQuery(f);
    Promise.all([fetchTrail(q), fetchTrailSummary(q)])
      .then(([records, summary]) => setState({ kind: 'ready', records, summary }))
      .catch((err: unknown) => {
        if (err instanceof ApiError) {
          setState({ kind: 'error', status: err.status, code: err.code, message: err.message });
        } else {
          setState({ kind: 'error', status: -1, code: 'unknown', message: String(err) });
        }
      });
  }, []);

  useEffect(() => {
    load(EMPTY_TRAIL_FILTER);
  }, [load]);

  if (state.kind === 'loading') {
    return (
      <section>
        <p className="muted">稽核軌跡載入中…</p>
      </section>
    );
  }

  if (state.kind === 'error') {
    const hint = errorHint(state.status);
    return (
      <section>
        <p style={{ color: '#b91c1c', fontWeight: 600 }}>稽核軌跡載入失敗（{state.code}）</p>
        <p className="muted" style={{ fontSize: '12.5px' }}>
          {state.message}
        </p>
        {hint && (
          <p className="muted" style={{ fontSize: '12.5px' }}>
            {hint}
          </p>
        )}
        <button className="btn primary" onClick={() => load(filter)}>
          重試
        </button>
      </section>
    );
  }

  const q = filterToQuery(filter);
  return (
    <IsoTrailView
      records={state.records}
      summary={state.summary}
      filter={filter}
      onFilterChange={setFilter}
      onApply={() => load(filter)}
      exportJsonHref={exportJsonUrl(q)}
      exportCsvHref={exportCsvUrl(q)}
    />
  );
}
