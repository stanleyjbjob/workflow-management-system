// 案件詳情畫面。顯示「所屬專案」並可反向跳回專案管理（issue 5.6 / §5.3）。
import { resolveProjectFromCase } from './navigation';
import type { CaseDetail as CaseDetailModel, Project } from './types';

export interface CaseDetailViewProps {
  caseDetail: CaseDetailModel;
  projects: Record<string, Project>;
  onJumpToProject: (projectId: string) => void;
  onBack: () => void;
}

export function CaseDetailView({
  caseDetail,
  projects,
  onJumpToProject,
  onBack,
}: CaseDetailViewProps): JSX.Element {
  const project = resolveProjectFromCase(caseDetail, projects);

  return (
    <section>
      <button
        onClick={onBack}
        style={{ border: 'none', background: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 12 }}
      >
        ← 返回專案管理
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>{caseDetail.title}</h2>
          <div style={{ color: '#64748b', fontSize: 13 }}>{caseDetail.meta}</div>
          <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {caseDetail.tags.map((t) => (
              <span key={t} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#e2e8f0', color: '#334155' }}>
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 所屬專案（反向導覽入口） */}
      <div style={{ marginTop: 14, padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6 }}>
        <span style={{ fontSize: 12, color: '#64748b', marginRight: 8 }}>所屬專案</span>
        {project ? (
          <button
            onClick={() => onJumpToProject(project.id)}
            style={{ border: 'none', background: 'none', color: '#2563eb', fontWeight: 600, cursor: 'pointer', fontSize: 14, padding: 0 }}
          >
            {project.name} ↗
          </button>
        ) : (
          <span style={{ color: '#94a3b8', fontSize: 14 }}>未指派專案</span>
        )}
        <span style={{ marginLeft: 16, fontSize: 12, color: '#64748b' }}>所屬流程：{caseDetail.flowLabel}</span>
      </div>

      {/* 步驟列表 */}
      <div style={{ marginTop: 16 }}>
        {caseDetail.steps.map((s, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 12,
              padding: '10px 12px',
              marginBottom: 8,
              borderRadius: 6,
              border: '1px solid #e2e8f0',
              background: s.active ? '#eff6ff' : '#fff',
            }}
          >
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                color: '#fff',
                background: s.done ? '#16a34a' : s.active ? '#2563eb' : '#cbd5e1',
              }}
            >
              {s.done ? '✓' : i + 1}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div>
              <div style={{ fontSize: 12, color: '#64748b', margin: '2px 0 4px' }}>{s.description}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 8, background: '#f1f5f9', color: '#475569' }}>👤 {s.role}</span>
                {s.forms.map((f) => (
                  <span key={f} style={{ fontSize: 11, padding: '1px 7px', borderRadius: 8, background: '#f1f5f9', color: '#475569' }}>📄 {f}</span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
