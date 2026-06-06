import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  derivePresentationLayout,
  formatDelta,
  isPresentation,
  presentationHeadline,
  presentationKeydown,
  selectKpiCards,
  statusMeta,
  toggleMode,
  type ViewMode,
} from './presentation';
import { sampleProjectGantt } from './seed';
import { ui } from './styles';
import type { GanttRow, ProjectGanttData } from './types';

const TONE_COLOR: Record<string, string> = {
  primary: '#2563eb',
  good: '#16a34a',
  warn: '#dc2626',
  muted: '#475569',
};

/** 嘗試進入 / 離開瀏覽器全螢幕（best-effort，環境不支援時靜默略過，不影響資料）。 */
function syncFullscreen(immersive: boolean): void {
  if (typeof document === 'undefined') return;
  try {
    const el = document.documentElement;
    if (immersive && !document.fullscreenElement && el.requestFullscreen) {
      void el.requestFullscreen().catch(() => undefined);
    } else if (!immersive && document.fullscreenElement && document.exitFullscreen) {
      void document.exitFullscreen().catch(() => undefined);
    }
  } catch {
    /* 全螢幕為加分項，失敗不影響簡報版面（fixed 覆蓋層已達沉浸效果）。 */
  }
}

/** 流程列是否可跳轉案件（有 caseId 且呼叫端有提供 onSelectCase）。 */
function rowJumpable(row: GanttRow, onSelectCase?: (caseId: string) => void): boolean {
  return !!onSelectCase && row.caseId != null && row.caseId !== '';
}

export interface ProjectGanttViewProps {
  /** 專案甘特資料；未提供時使用 seed 範例（REST 層就緒前）。 */
  data?: ProjectGanttData;
  /**
   * 點擊有對應案件之流程列時的回呼（issue #28，5.6）。
   * 未提供時流程列不提供跳轉（§5.3「無對應案件之流程不提供跳轉」亦含此情況）。
   */
  onSelectCase?: (caseId: string) => void;
}

/**
 * 專案進度甘特圖 + 簡報模式（issue #27，5.5）+ 案件雙向導覽（issue #28，5.6）。
 *
 * 簡報模式：一鍵切換，隱藏側欄與次要工具列、放大時間軸與重點 KPI、進入沉浸版面，
 * 並支援鍵盤（F/P 切換、Esc 退出）。所有切換僅影響呈現版面，不變動任何資料。
 * 雙向導覽：有對應案件（caseId）之流程列可點擊跳轉案件詳情。
 */
export function ProjectGanttView({ data = sampleProjectGantt, onSelectCase }: ProjectGanttViewProps): JSX.Element {
  const [mode, setMode] = useState<ViewMode>('NORMAL');
  const layout = useMemo(() => derivePresentationLayout(mode), [mode]);
  const { project, view } = data;

  const onToggle = useCallback(() => setMode((m) => toggleMode(m)), []);

  // 鍵盤：F/P 切換、Esc 退出（純委派 presentationKeydown 決策）。
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const next = presentationKeydown(e.key, mode);
      if (next !== null && next !== mode) {
        e.preventDefault();
        setMode(next);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode]);

  // 全螢幕沉浸（best-effort）。
  useEffect(() => {
    syncFullscreen(layout.immersive);
  }, [layout.immersive]);

  const presenting = isPresentation(mode);
  const kpiCards = selectKpiCards(view.kpis, mode);

  const containerStyle: CSSProperties = presenting
    ? { ...ui.presentationOverlay, fontSize: `${layout.fontScale}rem` }
    : {};

  // 簡報模式下不啟用列跳轉（沉浸呈現，避免誤觸切換畫面）。
  const rowSelect = presenting ? undefined : onSelectCase;
  const chart = (
    <Chart
      data={data}
      rowHeightPx={layout.rowHeightPx}
      minHeightPx={layout.timelineMinHeightPx}
      onSelectCase={rowSelect}
    />
  );

  const kpiPanel = (
    <div style={ui.kpiRow}>
      {kpiCards.map((c) => (
        <div key={c.key} style={ui.kpiCard}>
          <div style={ui.kpiLabel}>{c.label}</div>
          <div style={{ ...ui.kpiValue, color: TONE_COLOR[c.tone] }}>{c.value}</div>
        </div>
      ))}
    </div>
  );

  const toolbar = (
    <div style={ui.toolbar}>
      <strong style={{ fontSize: '1.05rem' }}>{project.name}</strong>
      <span style={ui.muted}>
        {project.code}．{project.client}
      </span>
      <span style={ui.spacer} />
      <button
        type="button"
        style={{ ...ui.btn, ...ui.btnPrimary }}
        onClick={onToggle}
        aria-pressed={presenting}
      >
        {presenting ? '退出簡報（Esc）' : '進入簡報模式'}
      </button>
    </div>
  );

  if (presenting) {
    return (
      <div style={containerStyle} role="region" aria-label="簡報模式">
        {toolbar}
        <div style={{ ...ui.headline, fontSize: '1.1rem', fontWeight: 600 }}>
          {presentationHeadline(view)}
        </div>
        {kpiPanel}
        {chart}
      </div>
    );
  }

  return (
    <div>
      {toolbar}
      <div style={ui.layout}>
        {layout.showSidebar && (
          <aside style={ui.sidebar}>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 6 }}>掛載流程</div>
            {view.rows.map((r) => {
              const meta = statusMeta(r.status);
              const jumpable = rowJumpable(r, rowSelect);
              const jump = jumpable ? () => rowSelect!(r.caseId as string) : undefined;
              return (
                <div
                  key={r.id}
                  style={{ ...ui.listItem, ...(jumpable ? { cursor: 'pointer' } : null) }}
                  role={jumpable ? 'button' : undefined}
                  tabIndex={jumpable ? 0 : undefined}
                  onClick={jump}
                  onKeyDown={
                    jumpable
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            jump!();
                          }
                        }
                      : undefined
                  }
                  title={jumpable ? '點擊查看案件詳情' : undefined}
                >
                  <div style={{ fontWeight: 500, color: jumpable ? '#2563eb' : undefined }}>
                    {r.name}
                    {jumpable ? ' ↗' : ''}
                  </div>
                  <div style={ui.muted}>
                    {r.planStart} ~ {r.planEnd}
                    <span style={{ ...ui.pill, background: meta.bg, color: meta.color }}>
                      {meta.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </aside>
        )}
        <div style={ui.main}>
          {kpiPanel}
          {chart}
          {layout.showSecondaryChrome && (
            <p style={{ ...ui.muted, marginTop: '0.75rem' }}>
              提示：點「進入簡報模式」或按 F／P 鍵可放大畫面供會議簡報，按 Esc 退出。簡報模式僅切換版面，不影響資料。
              有「↗」標記的流程列可點擊查看對應案件詳情。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** 甘特圖本體（月份刻度 + 流程長條 + 完成填色 + 今日線 + 排除日網底）。 */
function Chart(props: {
  data: ProjectGanttData;
  rowHeightPx: number;
  minHeightPx: number;
  onSelectCase?: (caseId: string) => void;
}): JSX.Element {
  const { data, rowHeightPx, minHeightPx, onSelectCase } = props;
  const { view } = data;
  const pct = (n: number): string => `${(n * 100).toFixed(2)}%`;

  return (
    <div style={{ ...ui.chart, minHeight: minHeightPx }}>
      <div style={ui.monthsBar}>
        {view.axis.months.map((m) => (
          <span key={m.key} style={{ ...ui.monthTick, left: pct(m.startRatio) }}>
            {m.label}
          </span>
        ))}
      </div>

      <div style={{ position: 'relative' }}>
        {/* 排除日網底（橫跨所有列） */}
        <div style={{ position: 'absolute', inset: 0, marginLeft: 168, pointerEvents: 'none' }}>
          {view.exclusions.map((x, i) => (
            <div
              key={`${x.fromDate}-${i}`}
              style={{
                ...ui.exclusionBand,
                left: pct(x.startRatio),
                width: pct(Math.max(x.endRatio - x.startRatio, 0.004)),
              }}
              title={`${x.reason ?? '排除日'}（${x.fromDate} ~ ${x.toDate}）`}
            />
          ))}
        </div>

        {view.rows.map((r) => {
          const meta = statusMeta(r.status);
          const widthRatio = Math.max(r.endRatio - r.startRatio, 0.006);
          const jumpable = rowJumpable(r, onSelectCase);
          const jump = jumpable ? () => onSelectCase!(r.caseId as string) : undefined;
          return (
            <div key={r.id} style={{ ...ui.rowLine, height: rowHeightPx }}>
              <div
                style={{ ...ui.rowLabel, ...(jumpable ? { cursor: 'pointer', color: '#2563eb' } : null) }}
                title={jumpable ? `${r.name}（點擊查看案件詳情）` : r.name}
                role={jumpable ? 'button' : undefined}
                tabIndex={jumpable ? 0 : undefined}
                onClick={jump}
                onKeyDown={
                  jumpable
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          jump!();
                        }
                      }
                    : undefined
                }
              >
                {r.name}
                {jumpable ? ' ↗' : ''}
              </div>
              <div style={ui.rowTrack}>
                <div
                  style={{
                    ...ui.bar,
                    left: pct(r.startRatio),
                    width: pct(widthRatio),
                    height: Math.round(rowHeightPx * 0.5),
                    background: meta.bg,
                    border: `1px solid ${meta.color}`,
                  }}
                  title={`${r.name}：進度 ${r.progress}%（預期 ${r.expected}%，差異 ${formatDelta(
                    r.delta,
                  )}）`}
                >
                  <div style={{ ...ui.barFill, width: pct(r.fillRatio), background: meta.color }} />
                </div>
              </div>
            </div>
          );
        })}

        {/* 今日線 */}
        <div style={{ position: 'absolute', inset: 0, marginLeft: 168, pointerEvents: 'none' }}>
          {view.today.inRange && (
            <div style={{ ...ui.todayLine, left: pct(view.today.ratio) }} title={`今日 ${view.today.date}`} />
          )}
        </div>
      </div>
    </div>
  );
}
