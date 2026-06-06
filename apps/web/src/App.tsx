import { useEffect, useState } from 'react';
import { WorkflowDesigner } from './features/workflow-designer';
import { ProjectWorkspace } from './features/project-gantt';
import { TaskKanbanView } from './features/task-kanban';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

type Tab = 'status' | 'designer' | 'project' | 'kanban';

export function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('kanban');
  const [apiStatus, setApiStatus] = useState<string>('檢查中…');

  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then((r) => r.json())
      .then((d: { status?: string }) => setApiStatus(d.status === 'ok' ? '正常 (ok)' : '異常'))
      .catch(() => setApiStatus('無法連線'));
  }, []);

  const tabBtn = (key: Tab, label: string): JSX.Element => (
    <button
      onClick={() => setTab(key)}
      style={{
        padding: '0.4rem 0.9rem',
        border: 'none',
        borderBottom: tab === key ? '2px solid #2563eb' : '2px solid transparent',
        background: 'none',
        color: tab === key ? '#2563eb' : '#475569',
        cursor: 'pointer',
        fontSize: '0.95rem',
        fontWeight: tab === key ? 600 : 400,
      }}
    >
      {label}
    </button>
  );

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 1040, margin: '2rem auto', padding: '0 1rem' }}>
      <h1 style={{ marginBottom: '0.25rem' }}>工作流程管理系統</h1>
      <nav style={{ borderBottom: '1px solid #e2e8f0', marginBottom: '1rem' }}>
        {tabBtn('kanban', '任務看板')}
        {tabBtn('designer', '流程定義設計器')}
        {tabBtn('project', '專案進度')}
        {tabBtn('status', '系統狀態')}
      </nav>

      {tab === 'kanban' && <TaskKanbanView />}
      {tab === 'designer' && <WorkflowDesigner />}
      {tab === 'project' && <ProjectWorkspace />}
      {tab === 'status' && (
        <section>
          <p>API 健康狀態：<strong>{apiStatus}</strong></p>
          <p style={{ color: '#64748b' }}>後續功能依 issue 逐步開發。</p>
        </section>
      )}
    </main>
  );
}
