/**
 * 流程定義設計器（issue 2.2）。視覺對齊 prototype view-designer：
 * 上方 sec-title + 流程選擇 + 儲存；主體 .designer 兩欄（左：步驟卡，右：流程設定）。
 * 邏輯（designer.ts / storage.ts）不變。
 */
import { useEffect, useMemo, useState } from 'react';
import { flowTypeLabel } from './constants';
import { createEmptyWorkflow } from './designer';
import type { WorkflowSummary } from './designer';
import { localStorageRepository as repo } from './storage';
import { WorkflowEditor } from './WorkflowEditor';
import type { WorkflowDraft } from './types';

export function WorkflowDesigner(): JSX.Element {
  const [list, setList] = useState<WorkflowSummary[]>([]);
  const [current, setCurrent] = useState<WorkflowDraft | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const refresh = (): void => setList(repo.list());
  useEffect(() => {
    refresh();
  }, []);

  // 預設選取第一筆
  useEffect(() => {
    if (!current && list.length > 0) {
      const wf = repo.get(list[0].id);
      if (wf) setCurrent(wf);
    }
  }, [list, current]);

  const select = (id: string): void => {
    const wf = repo.get(id);
    if (wf) {
      setCurrent(wf);
      setSavedAt(null);
    }
  };

  const createNew = (): void => {
    const wf = createEmptyWorkflow();
    setCurrent(wf);
    setSavedAt(null);
  };

  const save = (): void => {
    if (!current) return;
    const saved = repo.save(current);
    setCurrent(saved);
    setSavedAt(new Date(saved.updatedAt).toLocaleString('zh-TW'));
    refresh();
  };

  const remove = (): void => {
    if (!current) return;
    repo.remove(current.id);
    setCurrent(null);
    setSavedAt(null);
    refresh();
  };

  const activeId = current?.id ?? '';
  const headerHint = useMemo(
    () => `共 ${list.length} 個流程定義（儲存於本機，作為新案件的流程來源）`,
    [list.length],
  );

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
          <button className="btn sm" onClick={createNew}>
            ＋ 新增流程
          </button>{' '}
          <button className="btn sm primary" onClick={save} disabled={!current}>
            💾 儲存流程
          </button>
          {savedAt && (
            <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
              已儲存：{savedAt}
            </span>
          )}
        </div>
      </div>

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
