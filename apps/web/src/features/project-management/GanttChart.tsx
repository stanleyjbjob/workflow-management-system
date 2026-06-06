// 甘特圖時間軸（§5.2）。流程列在有對應案件時可點擊跳轉（issue 5.6）。
import { ganttGeometry, type GanttBar } from './navigation';
import type { CaseDetail, FlowStatusKind, Project } from './types';

const STATUS_COLOR: Record<FlowStatusKind, string> = {
  COMPLETED: '#16a34a',
  AHEAD: '#16a34a',
  ON_TIME: '#2563eb',
  DELAYED: '#dc2626',
  NOT_STARTED: '#94a3b8',
};

function statusText(bar: GanttBar): string {
  const { label, deltaPct } = bar.status;
  if (deltaPct === undefined || bar.status.kind === 'ON_TIME') return label;
  return `${label} ${deltaPct > 0 ? '+' : ''}${deltaPct}%`;
}

export interface GanttChartProps {
  project: Project;
  cases: Record<string, CaseDetail>;
  today: string;
  onJumpToCase: (caseId: string) => void;
}

export function GanttChart({ project, cases, today, onJumpToCase }: GanttChartProps): JSX.Element {
  const geo = ganttGeometry(project, today, cases);

  return (
    <div style={{ minWidth: 600 }}>
      {/* 月份刻度 */}
      <div style={{ position: 'relative', height: 18, marginBottom: 4, marginLeft: 220 }}>
        {geo.months.map((m, i) => (
          <span key={i} style={{ position: 'absolute', left: `${m.leftPct}%`, fontSize: 11, color: '#64748b' }}>
            {m.label}
          </span>
        ))}
      </div>

      {geo.bars.map((bar) => {
        const color = STATUS_COLOR[bar.status.kind];
        const ref = bar.flow.caseRef;
        return (
          <div key={bar.flow.flowId} style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            {/* 流程標籤（可跳轉） */}
            <div
              role={bar.jumpable ? 'button' : undefined}
              tabIndex={bar.jumpable ? 0 : undefined}
              onClick={bar.jumpable && ref ? () => onJumpToCase(ref) : undefined}
              onKeyDown={
                bar.jumpable && ref
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') onJumpToCase(ref);
                    }
                  : undefined
              }
              title={bar.jumpable ? '點擊查看案件詳情' : '此流程尚無對應案件'}
              style={{
                width: 220,
                flexShrink: 0,
                paddingRight: 10,
                cursor: bar.jumpable ? 'pointer' : 'default',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: bar.jumpable ? '#2563eb' : '#1e293b' }}>
                {bar.flow.name}
                {bar.jumpable ? ' ↗' : ''}
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                {bar.flow.planStart} ~ {bar.flow.planEnd} ·{' '}
                <span style={{ color, fontWeight: 600 }}>{statusText(bar)}</span>
              </div>
            </div>
            {/* 軌道 + 長條 + 排除日 + 今日線 */}
            <div style={{ position: 'relative', flex: 1, height: 26, background: '#f1f5f9', borderRadius: 4 }}>
              {geo.bands.map((b, i) => (
                <div
                  key={`band-${i}`}
                  title={b.reason}
                  style={{
                    position: 'absolute',
                    left: `${b.leftPct}%`,
                    width: `${b.widthPct}%`,
                    top: 0,
                    bottom: 0,
                    background:
                      'repeating-linear-gradient(45deg,#fde68a,#fde68a 4px,transparent 4px,transparent 8px)',
                  }}
                />
              ))}
              {geo.todayLeftPct !== null && (
                <div
                  title={`今日 ${today}`}
                  style={{ position: 'absolute', left: `${geo.todayLeftPct}%`, top: -2, bottom: -2, width: 2, background: '#dc2626' }}
                />
              )}
              <div
                style={{
                  position: 'absolute',
                  left: `${bar.leftPct}%`,
                  width: `${bar.widthPct}%`,
                  top: 3,
                  height: 20,
                  background: '#dbeafe',
                  border: '1px solid #93c5fd',
                  borderRadius: 4,
                  overflow: 'hidden',
                }}
              >
                <div style={{ width: `${bar.flow.progress}%`, height: '100%', background: color, opacity: 0.55 }} />
                <span style={{ position: 'absolute', left: 6, top: 1, fontSize: 11, fontWeight: 600, color: '#1e293b' }}>
                  {bar.flow.progress}%
                </span>
              </div>
            </div>
          </div>
        );
      })}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b', marginTop: 6 }}>
        <span>🟦 計畫區間　▰ 已完成比例　🔴 今日基準線　▨ 排除日</span>
        <span>↗ 點流程名稱可跳至該案件詳情</span>
      </div>
    </div>
  );
}
