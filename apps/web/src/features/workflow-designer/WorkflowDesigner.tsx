/**
 * 流程定義設計器（issue 2.2；8.11 #46 改接 REST）。視覺對齊 prototype view-designer：
 * 上方 sec-title + 流程選擇 + 儲存；主體 .designer 兩欄（左：步驟卡，右：流程設定）。
 * 純編輯邏輯（designer.ts）不變；持久化改經 `/workflows` REST（api.ts），
 * 儲存的流程定義持久化於 DB、可套用於新案件。載入／錯誤／重試遵循 8.4 AsyncStates 慣例；
 * 儲存／刪除失敗以行內訊息呈現（403 權限不足、400 驗證錯誤碼…），不整頁打掉。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorState, LoadingState, toErrorState, type NormalizedError } from '../../components/AsyncStates';
import { restRepository as repo, seedIfEmpty } from './api';
import { flowTypeLabel } from './constants';
import { createEmptyWorkflow } from './designer';
import type { WorkflowSummary } from './designer';
import { WorkflowEditor } from './WorkflowEditor';
import type { WorkflowDraft } from './types';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; list: WorkflowSummary[] }
  | { kind: 'error'; error: NormalizedError };

export function WorkflowDesigner(): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [current, setCurrent] = useState<WorkflowDraft | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [actionError, setActionError] = useState<NormalizedError | null>(null);
  const [busy, setBusy] = useState(false);
  /** 遞增請求序號：僅最新請求的回應可落地（防過時回應覆蓋）。 */
  const seqRef = useRef(0);
  const seededRef = useRef(false);

  const load = useCallback((): void => {
    const seq = ++seqRef.current;
    setState((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    (async () => {
      // 首次使用（DB 全空）時嘗試載入四大標準流程種子；403 靜默略過。
      if (!seededRef.current) {
        seededRef.current = true;
        await seedIfEmpty(repo);
      }
      return repo.list();
    })()
      .then((list) => {
        if (seqRef.current !== seq) return;
        setState({ kind: 'ready', list });
      })
      .catch((err: unknown) => {
        if (seqRef.current !== seq) return;
        setState({ kind: 'error', error: toErrorState(err) });
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const list = state.kind === 'ready' ? state.list : [];

  // 預設選取第一筆
  useEffect(() => {
    if (state.kind !== 'ready' || current || state.list.length === 0) return;
    let cancelled = false;
    repo
      .get(state.list[0].id)
      .then((wf) => {
        if (!cancelled && wf) setCurrent(wf);
      })
      .catch((err: unknown) => {
        if (!cancelled) setActionError(toErrorState(err));
      });
    return () => {
      cancelled = true;
    };
  }, [state, current]);

  const select = (id: string): void => {
    setActionError(null);
    repo
      .get(id)
      .then((wf) => {
        if (wf) {
          setCurrent(wf);
          setSavedAt(null);
        }
      })
      .catch((err: unknown) => setActionError(toErrorState(err)));
  };

  const createNew = (): void => {
    setActionError(null);
    setCurrent(createEmptyWorkflow());
    setSavedAt(null);
  };

  const save = (): void => {
    if (!current || busy) return;
    setActionError(null);
    setBusy(true);
    repo
      .save(current)
      .then((saved) => {
        setCurrent(saved);
        setSavedAt(new Date(saved.updatedAt).toLocaleString('zh-TW'));
        load();
      })
      .catch((err: unknown) => setActionError(toErrorState(err)))
      .finally(() => setBusy(false));
  };

  const remove = (): void => {
    if (!current || busy) return;
    setActionError(null);
    setBusy(true);
    repo
      .remove(current.id)
      .then((result) => {
        setCurrent(null);
        setSavedAt(null);
        if (!result.deleted && result.deactivated) {
          setActionError({
            status: 200,
            code: 'workflow_deactivated',
            message: '此流程已被案件引用，無法刪除；已改為停用（不影響既有案件）。',
          });
        }
        load();
      })
      .catch((err: unknown) => setActionError(toErrorState(err)))
      .finally(() => setBusy(false));
  };

  const activeId = current?.id ?? '';
  const headerHint = useMemo(
    () => `共 ${list.length} 個流程定義（儲存於系統資料庫，作為新案件的流程來源）`,
    [list.length],
  );

  if (state.kind === 'loading') return <LoadingState label="流程定義載入中…" />;
  if (state.kind === 'error') return <ErrorState title="流程定義載入失敗" error={state.error} onRetry={load} />;

  return (
    <section>
      <div className="banner">
        🧩 主管可自訂流程：步驟順序、負責角色、每步應填表單與產出、以及完成後的下一步。{headerHint}。
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div className="sec-title" style={{ margin: 0 }}>
          流程：
          <select className="btn" value={activeId} onChange={(e) => select(e.target.value)}>
            {list.length === 0 && <option value="">（尚無流程定義）</option>}
            {current && !list.some((s) => s.id === current.id) && (
              <option value={current.id}>{current.name || '（未命名流程）'}＊未儲存</option>
            )}
            {list.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || '（未命名流程）'}（{flowTypeLabel(s.flowType)} · v{s.version} · {s.stepCount} 步{s.isActive ? '' : ' · 停用'}）
              </option>
            ))}
          </select>
        </div>
        <div>
          <button className="btn sm" onClick={createNew} disabled={busy}>
            ＋ 新增流程
          </button>{' '}
          <button className="btn sm primary" onClick={save} disabled={!current || busy}>
            💾 {busy ? '處理中…' : '儲存流程'}
          </button>
          {savedAt && (
            <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
              已儲存：{savedAt}
            </span>
          )}
        </div>
      </div>

      {actionError && (
        <div className="banner" style={{ color: '#b91c1c' }}>
          ⚠ 操作未完成（{actionError.code}）：{actionError.message}
        </div>
      )}

      {current ? (
        <WorkflowEditor workflow={current} onChange={setCurrent} onSave={save} onDelete={remove} savedAt={savedAt} />
      ) : (
        <div className="card pad">
          <p className="muted">請從上方選擇流程，或點「＋ 新增流程」開始設計。</p>
        </div>
      )}
    </section>
  );
}
