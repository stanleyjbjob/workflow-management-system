/**
 * 案件詳情面板（issue #28，5.6 / §5.3）。
 * 顯示案件步驟與「所屬專案」，並提供反向跳回專案甘特圖之入口；
 * 未指派專案（projectCode=null）時顯示說明、不提供反向跳轉。
 * 視覺對齊 prototype（card / stepper 風格、pill、chip）。
 */
import { canJumpToProject, type CaseSummary } from './cases';

export interface CaseDetailPanelProps {
  caseSummary: CaseSummary;
  /** 反向跳回所屬專案（專案管理畫面）。 */
  onJumpToProject: () => void;
  /** 返回甘特圖。 */
  onBack: () => void;
}

export function CaseDetailPanel({ caseSummary, onJumpToProject, onBack }: CaseDetailPanelProps): JSX.Element {
  const jumpable = canJumpToProject(caseSummary);

  return (
    <div>
      <div className="row" style={{ marginBottom: 14 }}>
        <button type="button" className="btn sm" onClick={onBack}>
          ← 返回甘特圖
        </button>
      </div>

      <div className="card pad">
        <div className="case-head">
          <div>
            <h2>{caseSummary.title}</h2>
            <div className="muted">{caseSummary.meta}</div>
          </div>
          <div>
            {caseSummary.tags.map((t) => (
              <span key={t} className="pill p-grey" style={{ marginLeft: 6 }}>
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* 所屬專案（反向導覽入口，§5.3） */}
        <ul className="meta-list" style={{ marginTop: 12 }}>
          <li>
            <span className="k">所屬專案</span>
            {jumpable ? (
              <span
                style={{ color: 'var(--brand)', fontWeight: 600, cursor: 'pointer' }}
                onClick={onJumpToProject}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onJumpToProject();
                }}
              >
                {caseSummary.projectName ?? caseSummary.projectCode} ↗
              </span>
            ) : (
              <span className="muted">未指派專案</span>
            )}
          </li>
          <li>
            <span className="k">所屬流程</span>
            <span>{caseSummary.flowLabel}</span>
          </li>
        </ul>
      </div>

      {/* 步驟列表 */}
      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 0 }}>
        {caseSummary.steps.map((s, i) => (
          <div key={i}>
            {i > 0 && <div className="flow-conn" />}
            <div className="flow-step" style={s.active ? { borderColor: 'var(--brand)', boxShadow: '0 0 0 3px var(--brand-l)' } : undefined}>
              <div
                className="seq"
                style={{ background: s.done ? 'var(--green)' : s.active ? 'var(--brand)' : '#c4cdd9', borderRadius: '50%' }}
              >
                {s.done ? '✓' : i + 1}
              </div>
              <div className="body">
                <div className="nm">{s.name}</div>
                <div className="muted" style={{ fontSize: '12.5px' }}>
                  {s.description}
                </div>
                <div className="chip-set">
                  <span className="chip role">👤 {s.role}</span>
                  {s.forms.map((f) => (
                    <span key={f} className="chip">
                      📄 {f}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
