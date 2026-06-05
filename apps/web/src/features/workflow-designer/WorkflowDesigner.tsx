import { useEffect, useMemo, useState } from 'react';
import { flowTypeLabel } from './constants';
import { createEmptyWorkflow } from './designer';
import type { WorkflowSummary } from './designer';
import { localStorageRepository as repo } from './storage';
import { WorkflowEditor } from './WorkflowEditor';
import type { WorkflowDraft } from './types';
import { ui } from './styles';

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

  const activeId = current?.id ?? null;
  const headerHint = useMemo(
    () => `共 ${list.length} 個流程定義（儲存於本機，作為新案件的流程來源）`,
    [list.length],
  );

  return (
    <section>
      <p style={ui.muted}>{headerHint}</p>
      <div style={ui.layout}>
        <aside style={ui.sidebar}>
          <button style={{ ...ui.btn, ...ui.btnPrimary, width: '100%', marginBottom: '0.6rem' }} onClick={createNew}>
            + 新增流程
          </button>
          {list.length === 0 && <div style={ui.muted}>尚無流程定義。</div>}
          {list.map((s) => (
            <button
              key={s.id}
              style={{ ...ui.listItem, ...(s.id === activeId ? ui.listItemActive : {}) }}
              onClick={() => select(s.id)}
            >
              <div style={{ fontWeight: 600 }}>{s.name || '（未命名流程）'}</div>
              <div style={ui.muted}>
                {flowTypeLabel(s.flowType)} · v{s.version} · {s.stepCount} 步
                {!s.isActive && <span style={ui.pill}>停用</span>}
              </div>
            </button>
          ))}
        </aside>

        {current ? (
          <WorkflowEditor
            workflow={current}
            onChange={setCurrent}
            onSave={save}
            onDelete={remove}
            savedAt={savedAt}
          />
        ) : (
          <div style={ui.editor}>
            <p style={ui.muted}>請從左側選擇流程，或點「+ 新增流程」開始設計。</p>
          </div>
        )}
      </div>
    </section>
  );
}
