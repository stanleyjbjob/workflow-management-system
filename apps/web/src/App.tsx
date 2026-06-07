/**
 * AppShell（對齊 prototype/index.html 的整體版型）：
 *  - 左側深色 sidebar：作業（流程看板/待辦、案件詳情/推進）、專案（專案管理）、設定（流程定義設計器、ISO 文件對應）。
 *  - 頂部 topbar：當前頁標題/副標 + 帳號徽章 + 角色切換（前端視角過濾用）。
 *  - 內容區：各 feature 頁面。
 */
import { useEffect, useState } from 'react';
import { WorkflowDesigner } from './features/workflow-designer';
import { ProjectWorkspace } from './features/project-gantt';
import { TaskKanbanView } from './features/task-kanban';
import { CaseDetailView } from './features/case-detail';
import { IsoMappingView } from './features/iso-mapping';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

type View = 'board' | 'case' | 'project' | 'designer' | 'iso';

const VIEW_META: Record<View, { title: string; sub: string }> = {
  board: { title: '流程看板 / 待辦', sub: '以你的角色視角，檢視待辦任務、待填表單與到期提醒' },
  case: { title: '案件詳情 / 推進', sub: '檢視單一案件的步驟推進、表單與產出、下一步與負責人' },
  project: { title: '專案管理', sub: '甘特圖時間軸掌握各流程進度、延遲/超前與排除日' },
  designer: { title: '流程定義設計器', sub: '自訂步驟順序、負責角色、表單產出與下一步' },
  iso: { title: 'ISO 文件對應', sub: '流程表單對應 ISO 27001 文件化需求與覆蓋狀態' },
};

const ROLES = ['業務', '顧問', '工程主管', '工程師', '部門主管'] as const;

export function App(): JSX.Element {
  const [view, setView] = useState<View>('board');
  const [role, setRole] = useState<string>('部門主管');
  const [caseId, setCaseId] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<string>('檢查中…');

  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then((r) => r.json())
      .then((d: { status?: string }) => setApiStatus(d.status === 'ok' ? 'API 連線正常' : 'API 異常'))
      .catch(() => setApiStatus('API 未連線（示範資料）'));
  }, []);

  const openCase = (id: string): void => {
    setCaseId(id);
    setView('case');
  };

  const navItem = (key: View, icon: string, label: string): JSX.Element => (
    <a
      className={view === key ? 'active' : undefined}
      onClick={() => setView(key)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') setView(key);
      }}
    >
      <span className="ic">{icon}</span> {label}
    </a>
  );

  const meta = VIEW_META[view];

  return (
    <div className="app">
      <aside className="side">
        <div className="logo">
          <span className="dot">⚙</span> 流程管理系統
        </div>
        <div className="nav-label">作業</div>
        <nav className="nav">
          {navItem('board', '📋', '流程看板 / 待辦')}
          {navItem('case', '🗂️', '案件詳情 / 推進')}
        </nav>
        <div className="nav-label">專案</div>
        <nav className="nav">{navItem('project', '📊', '專案管理')}</nav>
        <div className="nav-label">設定</div>
        <nav className="nav">
          {navItem('designer', '🧩', '流程定義設計器')}
          {navItem('iso', '🛡️', 'ISO 文件對應')}
        </nav>
        <div className="nav-label">系統</div>
        <div style={{ fontSize: '11.5px', color: '#7e93ab', padding: '4px 10px', lineHeight: 1.6 }}>{apiStatus}</div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div>
            <h1>{meta.title}</h1>
            <div className="sub">{meta.sub}</div>
          </div>
          <div className="role-switch">
            <span className="acct">
              <span className="av">S</span>
              <span>
                <span className="nm">Stanley</span>
                <br />
                <span className="em">stanley@jiebao.onmicrosoft.com</span>
              </span>
            </span>
            目前身分
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="content">
          {view === 'board' && <TaskKanbanView onOpenCase={openCase} />}
          {view === 'case' && <CaseDetailView caseId={caseId} />}
          {view === 'project' && <ProjectWorkspace />}
          {view === 'designer' && <WorkflowDesigner />}
          {view === 'iso' && <IsoMappingView />}
        </div>
      </main>
    </div>
  );
}
