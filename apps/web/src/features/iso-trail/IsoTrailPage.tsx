/**
 * 稽核軌跡頁容器（issue 8.3 #35）：由 REST 取得真實資料（非 seed），
 * 過濾條件改變後按「套用過濾」重新取數；處理載入 / 錯誤（401 未登入、403 權限不足、0 連線失敗）。
 * 成功後交給 IsoTrailView 呈現（與 TaskKanbanPage 同模式）。
 *
 * 載入 / 錯誤狀態改用共用元件（issue 8.4 #39，全站一致；401 已由 client 統一導向 SSO）。
 */
import { useCallback, useEffect, useState } from 'react';
import { ErrorState, LoadingState, toErrorState, type NormalizedError } from '../../components/AsyncStates';
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
  | { kind: 'error'; error: NormalizedError };

export function IsoTrailPage(): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [filter, setFilter] = useState<TrailFilterState>(EMPTY_TRAIL_FILTER);

  const load = useCallback((f: TrailFilterState): void => {
    setState({ kind: 'loading' });
    const q = filterToQuery(f);
    Promise.all([fetchTrail(q), fetchTrailSummary(q)])
      .then(([records, summary]) => setState({ kind: 'ready', records, summary }))
      .catch((err: unknown) => setState({ kind: 'error', error: toErrorState(err) }));
  }, []);

  useEffect(() => {
    load(EMPTY_TRAIL_FILTER);
  }, [load]);

  if (state.kind === 'loading') return <LoadingState label="稽核軌跡載入中…" />;
  if (state.kind === 'error') return <ErrorState title="稽核軌跡載入失敗" error={state.error} onRetry={() => load(filter)} />;

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
