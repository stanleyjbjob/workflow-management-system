/**
 * 案件詳情面板（issue #28，5.6 / §5.3）。
 * 顯示案件步驟與「所屬專案」，並提供反向跳回專案甘特圖之入口；
 * 未指派專案（projectCode=null）時顯示說明、不提供反向跳轉。
 */
import { canJumpToProject, type CaseSummary } from './cases';
import { ui } from './styles';

export interface CaseDetailPanelProps {
  caseSummary: CaseSummary;
  /** 反向跳回所屬專案（專案管理畫面）。 */
  onJumpToProject: () => void;
  /** 返回甘特圖。 */
  onBack: () => void;
}

const linkBtn = {
  border: 'none',
  background: 'none',
  color: '#2563eb',
  cursor: 'pointer',
  padding: 0,
  font: 'inherit',
} as const;

export function CaseDetailPanel({ caseSummary, onJumpToProject, onBack }: CaseDetailPanelProps): JSX.Element {
  const jumpable = canJumpToProject(caseSummary);

  return (
    <div>
      <div style={ui.toolbar}>
        <button type="button" style={{ ...ui.btn }} onClick={onBack}>
          ← 返回甘特圖
        </button>
        <span style={ui.spacer} />
      </div>

      <h2 style={{ margin: '0 0 4px', fontSize: '1.25rem' }}>{caseSummary.title}</h2>
      <div style={ui.muted}>{caseSummary.meta}</div>
      <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {caseSummary.tags.map((t) => (
          <span key={t} style={{ ...ui.pill, background: '#e2e8f0', color: '#334155' }}>
            {t}
          </span>
        ))}
      </div>

      {/* 所屬專案（反向導覽入口，§5.3） */}
      <div
        style={{
          marginTop: 14,
          padding: '10px 14px',
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
        }}
      >
        <span style={{ ...ui.muted, marginRight: 8 }}>所屬專案</span>
        {jumpable ? (
          <button type="button" style={{ ...linkBtn, fontWeight: 600 }} onClick={onJumpToProject}>
            {caseSummary.projectName ?? caseSummary.projectCode} ↗
          </button>
        ) : (
          <span style={ui.muted}>未指派專案</span>
        )}
        <span style={{ ...ui.muted, marginLeft: 16 }}>所屬流程：{caseSummary.flowLabel}</span>
      </div>

      {/* 步驟列表 */}
      <div style={{ marginTop: 16 }}>
        {caseSummary.steps.map((s, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 12,
              padding: '10px 12px',
              marginBottom: 8,
              borderRadius: 8,
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
              <div style={{ fontWeight: 600 }}>{s.name}</div>
              <div style={{ ...ui.muted, margin: '2px 0 4px' }}>{s.description}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ ...ui.pill, background: '#f1f5f9', color: '#475569' }}>👤 {s.role}</span>
                {s.forms.map((f) => (
                  <span key={f} style={{ ...ui.pill, background: '#f1f5f9', color: '#475569' }}>
                    📄 {f}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
