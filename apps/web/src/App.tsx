import { useEffect, useMemo, useState } from 'react';
import { WorkflowDesigner } from './features/workflow-designer';
import { ProjectWorkspacePage } from './features/project-gantt';
import { TaskKanbanPage } from './features/task-kanban';
import { IsoTrailPage } from './features/iso-trail';
import { AccountBadge, primaryRole, useSession } from './features/auth';
import { API_BASE } from './lib/api';

type Tab = 'status' | 'designer' | 'kanban' | 'project' | 'iso';

export function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('designer');
  const [apiStatus, setApiStatus] = useState<string>('檢查中…');
  const session = useSession();

  // 檢視角色（過濾用，非授權）：登入後預設為使用者主要角色。
  const [viewRole, setViewRole] = useState<string | null>(null);
  useEffect(() => {
    if (session.state.status === 'authenticated') {
      const roles = session.state.user.roles;
      setViewRole((prev) => prev ?? primaryRole(roles));
    } else {
      setViewRole(null);
    }
  }, [session.state]);

  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then((r) => r.json())
      .then((d: { status?: string }) => setApiStatus(d.status === 'ok' ? '正常 (ok)' : '異常'))
      .catch(() => setApiStatus('無法連線'));
  }, []);

  const isAuthenticated = session.state.status === 'authenticated';
  const currentUser = useMemo(
    () => (session.state.status === 'authenticated' ? session.state.user : null),
    [session.state],
  );

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
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '1rem',
          marginBottom: '0.25rem',
        }}
      >
        <h1 style={{ margin: 0 }}>工作流程管理系統</h1>
        <AccountBadge
          state={session.state}
          onLogin={session.login}
          onLogout={() => void session.logout()}
          onReload={session.reload}
          viewRole={viewRole}
          onViewRoleChange={setViewRole}
        />
      </header>

      <nav style={{ borderBottom: '1px solid #e2e8f0', marginBottom: '1rem' }}>
        {tabBtn('designer', '流程定義設計器')}
        {tabBtn('kanban', '任務看板')}
        {tabBtn('project', '專案進度')}
        {tabBtn('iso', '稽核軌跡')}
        {tabBtn('status', '系統狀態')}
      </nav>

      {tab === 'designer' && <WorkflowDesigner />}
      {tab === 'kanban' && <TaskKanbanPage />}
      {tab === 'project' && <ProjectWorkspacePage currentUserId={currentUser?.sub ?? null} />}
      {tab === 'iso' && <IsoTrailPage />}
      {tab === 'status' && (
        <section>
          <p>
            API 健康狀態：<strong>{apiStatus}</strong>
          </p>
          <p>
            登入狀態：
            <strong>
              {isAuthenticated && currentUser
                ? `${currentUser.name}（${currentUser.email}）`
                : session.state.status === 'loading'
                  ? '載入中…'
                  : '未登入'}
            </strong>
          </p>
          <p style={{ color: '#64748b' }}>後續功能依 issue 逐步開發。</p>
        </section>
      )}
    </main>
  );
}
