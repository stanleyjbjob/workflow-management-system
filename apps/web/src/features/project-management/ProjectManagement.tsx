// 專案管理容器：整合甘特圖（§5.2）、KPI（§5.1）、案件詳情，並串起專案↔案件雙向導覽（issue 5.6）。
import { useMemo, useState } from 'react';
import { CaseDetailView } from './CaseDetail';
import { GanttChart } from './GanttChart';
import { flowStatus, projectKpis, resolveProjectFromCase } from './navigation';
import { DEMO_TODAY, seedCases, seedProjects } from './seed';
import type { CaseDetail, FlowStatusKind, Project } from './types';

type View = { kind: 'project'; projectId: string } | { kind: 'case'; caseId: string };

const STATUS_COLOR: Record<FlowStatusKind, string> = {
  COMPLETED: '#16a34a',
  AHEAD: '#16a34a',
  ON_TIME: '#2563eb',
  DELAYED: '#dc2626',
  NOT_STARTED: '#94a3b8',
};

export interface ProjectManagementProps {
  projects?: Record<string, Project>;
  cases?: Record<string, CaseDetail>;
  today?: string;
}

export function ProjectManagement({
  projects = seedProjects,
  cases = seedCases,
  today = DEMO_TODAY,
}: ProjectManagementProps): JSX.Element {
  const firstProjectId = Object.keys(projects)[0] ?? '';
  const [view, setView] = useState<View>({ kind: 'project', projectId: firstProjectId });
  const [present, setPresent] = useState(false);

  // 甘特圖流程列 → 案件詳情（§5.3）
  const jumpToCase = (caseId: string): void => {
    if (Object.prototype.hasOwnProperty.call(cases, caseId)) setView({ kind: 'case', caseId });
  };
  // 案件詳情「所屬專案」→ 反向跳回專案（§5.3）
  const jumpToProject = (projectId: string): void => {
    if (Object.prototype.hasOwnProperty.call(projects, projectId)) setView({ kind: 'project', projectId });
  };

  if (view.kind === 'case') {
    const caseDetail = cases[view.caseId];
    const project = resolveProjectFromCase(caseDetail, projects);
    return (
      <CaseDetailView
        caseDetail={caseDetail}
        projects={projects}
        onJumpToProject={jumpToProject}
        onBack={() => setView({ kind: 'project', projectId: project?.id ?? firstProjectId })}
      />
    );
  }

  const project = projects[view.projectId];
  return (
    <ProjectView
      project={project}
      projects={projects}
      cases={cases}
      today={today}
      present={present}
      onSelectProject={(id) => setView({ kind: 'project', projectId: id })}
      onTogglePresent={() => setPresent((p) => !p)}
      onJumpToCase={jumpToCase}
    />
  );
}

interface ProjectViewProps {
  project: Project;
  projects: Record<string, Project>;
  cases: Record<string, CaseDetail>;
  today: string;
  present: boolean;
  onSelectProject: (id: string) => void;
  onTogglePresent: () => void;
  onJumpToCase: (caseId: string) => void;
}

function ProjectView(props: ProjectViewProps): JSX.Element {
  const { project, projects, cases, today, present, onSelectProject, onTogglePresent, onJumpToCase } = props;
  const kpis = useMemo(() => projectKpis(project, today), [project, today]);

  return (
    <section style={present ? { padding: 8 } : undefined}>
      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, padding: '8px 12px', fontSize: 13, color: '#1e40af', marginBottom: 14 }}>
        📊 專案可串接多個流程，於甘特圖時間軸掌握各流程進度與延遲/超前；可定義專案行事曆排除日，並切換簡報模式於會議呈現。
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>{project.name}</h2>
          <div style={{ color: '#64748b', fontSize: 13 }}>
            客戶：{project.client} · 負責：{project.owner} · 期間：{project.planStart} ~ {project.planEnd}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!present && (
            <select
              value={project.id}
              onChange={(e) => onSelectProject(e.target.value)}
              style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13 }}
            >
              {Object.values(projects).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={onTogglePresent}
            style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontSize: 13 }}
          >
            {present ? '✖ 結束簡報' : '🖥️ 簡報模式'}
          </button>
        </div>
      </div>

      {/* KPI */}
      <div style={{ display: 'flex', gap: 12, margin: '14px 0' }}>
        {[
          { l: '整體進度', v: `${kpis.overall}%`, c: '#2563eb' },
          { l: '延遲流程', v: kpis.delayed, c: '#dc2626' },
          { l: '超前流程', v: kpis.ahead, c: '#16a34a' },
          { l: '排除日區間', v: kpis.exclusionRanges, c: '#d97706' },
        ].map((d) => (
          <div key={d.l} style={{ flex: 1, padding: '12px 14px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: d.c }}>{d.v}</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{d.l}</div>
          </div>
        ))}
      </div>

      <div style={{ fontWeight: 600, fontSize: 14, margin: '8px 0' }}>流程時間軸（甘特圖）</div>
      <GanttChart project={project} cases={cases} today={today} onJumpToCase={onJumpToCase} />

      {!present && (
        <div style={{ display: 'flex', gap: 16, marginTop: 18, flexWrap: 'wrap' }}>
          {/* 流程狀態清單 */}
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>各流程狀態</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {project.flows.map((f) => {
                const st = flowStatus(f, today);
                const txt = st.deltaPct !== undefined && st.kind !== 'ON_TIME' ? `${st.label} ${st.deltaPct > 0 ? '+' : ''}${st.deltaPct}%` : st.label;
                return (
                  <li key={f.flowId} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                    <span>{f.name}</span>
                    <span style={{ color: STATUS_COLOR[st.kind], fontWeight: 600 }}>{txt}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          {/* 專案行事曆排除日 */}
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>專案行事曆 — 排除日</div>
            {project.exclusions.length ? (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {project.exclusions.map((x, i) => (
                  <li key={i} style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                    {x.from} ~ {x.to}
                    <div style={{ fontSize: 11, color: '#64748b' }}>{x.reason}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <div style={{ fontSize: 12, color: '#94a3b8' }}>尚無排除日，新增後甘特圖會以斜線標示並避開排程。</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
