/**
 * 假日維護頁容器（issue 8.14 #49）：REST 取數＋CRUD 寫入（與 IsoTrailPage 同模式）。
 *
 * - 進入頁面以預設過濾（當年度全年）取數；「套用過濾／套用年度」重新取數。
 * - 寫入（新增／更新／刪除）前先以 validateDraft 就地驗證（鏡像後端錯誤碼），
 *   後端錯誤（holiday_date_duplicate 等）經 writeErrorMessage 轉中文提示；寫入成功後重抓清單。
 * - 權限：頁面入口由 App 以 isManager 控制；後端仍以 admin:manage 為最終權威（403 顯示提示）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorState, LoadingState, toErrorState, type NormalizedError } from '../../components/AsyncStates';
import { createHoliday, deleteHoliday, fetchHolidays, patchHoliday } from './api';
import {
  defaultFilter,
  toHolidayQuery,
  validateDraft,
  writeErrorMessage,
  type HolidayDraft,
  type HolidayFilterState,
} from './holiday-admin-view';
import { HolidayAdminView } from './HolidayAdminView';
import type { HolidayRecord } from './types';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; records: HolidayRecord[] }
  | { kind: 'error'; error: NormalizedError };

export function HolidayAdminPage(): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [filter, setFilter] = useState<HolidayFilterState>(() => defaultFilter());
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  // 防競態：僅最後一次取數可落地（與 TaskKanbanPage 序號法一致）。
  const seqRef = useRef(0);

  const load = useCallback((f: HolidayFilterState): void => {
    const seq = ++seqRef.current;
    setState({ kind: 'loading' });
    fetchHolidays(toHolidayQuery(f))
      .then((records) => {
        if (seqRef.current === seq) setState({ kind: 'ready', records });
      })
      .catch((err: unknown) => {
        if (seqRef.current === seq) setState({ kind: 'error', error: toErrorState(err) });
      });
  }, []);

  useEffect(() => {
    load(filter);
    // 僅掛載時取數；其後由「套用過濾」明確觸發。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  /** 共用寫入流程：驗證 → 呼叫 API → 成功重抓；回傳是否成功（供 View 清空表單）。 */
  const write = useCallback(
    async (action: () => Promise<unknown>): Promise<boolean> => {
      setBusy(true);
      setWriteError(null);
      try {
        await action();
        load(filter);
        return true;
      } catch (err: unknown) {
        const e = toErrorState(err);
        setWriteError(writeErrorMessage(e.code, `寫入失敗（${e.code}）：${e.message}`));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [filter, load],
  );

  const handleCreate = useCallback(
    (draft: HolidayDraft): Promise<boolean> => {
      const v = validateDraft(draft);
      if (!v.ok) {
        setWriteError(writeErrorMessage(v.code, v.code));
        return Promise.resolve(false);
      }
      return write(() => createHoliday(v.payload));
    },
    [write],
  );

  const handleUpdate = useCallback(
    (id: string, draft: HolidayDraft): Promise<boolean> => {
      const v = validateDraft(draft);
      if (!v.ok) {
        setWriteError(writeErrorMessage(v.code, v.code));
        return Promise.resolve(false);
      }
      return write(() => patchHoliday(id, v.payload));
    },
    [write],
  );

  const handleDelete = useCallback(
    (id: string): void => {
      // eslint-disable-next-line no-alert
      if (!window.confirm('確定刪除這筆假日／補班？刪除後看板與排程遞延將立即反映。')) return;
      void write(() => deleteHoliday(id));
    },
    [write],
  );

  if (state.kind === 'loading') return <LoadingState label="假日資料載入中…" />;
  if (state.kind === 'error') {
    return <ErrorState title="假日資料載入失敗" error={state.error} onRetry={() => load(filter)} />;
  }

  return (
    <HolidayAdminView
      records={state.records}
      filter={filter}
      onFilterChange={setFilter}
      onApply={() => load(filter)}
      onCreate={handleCreate}
      onUpdate={handleUpdate}
      onDelete={handleDelete}
      busy={busy}
      writeError={writeError}
    />
  );
}
