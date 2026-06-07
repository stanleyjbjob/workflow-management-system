/**
 * 專案進度甘特圖 + 簡報模式（issue #27，5.5）+ 案件雙向導覽（issue #28，5.6）。
 * 視覺對齊 prototype/index.html（view-project）：
 *  - 上：專案表頭卡（名稱/代碼/客戶 + 簡報模式按鈕）+ KPI（grid-kpi）。
 *  - 中：流程時間軸甘特圖（g-months / g-row / g-bar+fill+pct / 今日線 / 排除日網底）+ legend。
 *  - 下：各流程進度狀態、專案行事曆排除日（detail-grid）。
 * 簡報模式：一鍵切換沉浸覆蓋層，隱藏次要 chrome、放大時間軸與 KPI；F/P 切換、Esc 退出。
 * 所有切換僅影響呈現版面，不變動任何資料。
 */
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
  primary: 'var(--brand)',
  good: 'var(--green)',
  warn: 'var(--red)',
  muted: 'var(--muted)',
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
  /** 點擊有對應案件之流程列時的回呼（issue #28，5.6）。未提供時不提供跳轉。 */
  onSelectCase?: (caseId: string) => void;
}

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

  // 簡報模式下不啟用列跳轉（沉浸呈現，避免誤觸切換畫面）。
  const rowSelect = presenting ? undefined : onSelectCase;

  const kpiPanel = (
    <div className="grid-kpi" style={{ margin: '18px 0 4px' }}>
      {kpiCards.map((c) => (
        <div key={c.key} className="card kpi">
          <div className="n" style={{ color: TONE_COLOR[c.tone] }}>
            {c.value}
          </div>
          <div className="l">{c.label}</div>
        </div>
      ))}
    </div>
  );

  const headerCard = (
    <div className="card pad">
      <div className="case-head">
        <div>
          <h2>{project.name}</h2>
          <div className="muted">
            {project.code}　·　{project.client}　·　{project.planStart} ~ {project.planEnd}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <button className="btn sm" onClick={onToggle} aria-pressed={presenting}>
            {presenting ? '⏏ 退出簡報（Esc）' : '🖥️ 簡報模式'}
          </button>
        </div>
      </div>
      {kpiPanel}
    </div>
  );

  const chartCard = (
    <div className="card pad" style={{ marginTop: 16, overflow: 'auto' }}>
      <div className="sec-title">流程時間軸（甘特圖）</div>
      <Chart data={data} rowHeightPx={layout.rowHeightPx} onSelectCase={rowSelect} />
      <div className="legend">
        <span>🟦 計畫區間　▰ 已完成比例　🔴 今日基準線　▨ 排除日</span>
        <span>↗ 點流程名稱可跳至該案件詳情</span>
      </div>
    </div>
  );

  if (presenting) {
    const overlay: CSSProperties = { ...ui.presentationOverlay, fontSize: `${layout.fontScale}rem`, background: 'var(--bg)' };
    return (
      <div style={overlay} role="region" aria-label="簡報模式">
        <div className="sec-title" style={{ fontSize: 18 }}>
          {project.name}
          <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
            {presentationHeadline(view)}
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn sm" onClick={onToggle}>
            ⏏ 退出簡報（Esc）
          </button>
        </div>
        {kpiPanel}
        {chartCard}
      </div>
    );
  }

  return (
    <section className={presenting ? 'present' : undefined}>
      {layout.showSecondaryChrome && (
        <div className="banner">
          📊 專案可串接多個流程，於甘特圖時間軸掌握各流程進度與延遲/超前；可定義專案行事曆排除日，並切換簡報模式於會議呈現。
        </div>
      )}
      {headerCard}
      {chartCard}

      <div className="detail-grid" style={{ marginTop: 16 }}>
        <div className="card pad">
          <div className="sec-title" style={{ fontSize: 14 }}>
            各流程進度狀態
          </div>
          <ul className="meta-list">
            {view.rows.map((r) => {
              const meta = statusMeta(r.status);
              const jumpable = rowJumpable(r, rowSelect);
              return (
                <li key={r.id}>
                  <span
                    style={jumpable ? { color: 'var(--brand)', fontWeight: 600, cursor: 'pointer' } : undefined}
                    onClick={jumpable ? () => rowSelect!(r.caseId as string) : undefined}
                    role={jumpable ? 'button' : undefined}
                    tabIndex={jumpable ? 0 : undefined}
                    onKeyDown={
                      jumpable
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') rowSelect!(r.caseId as string);
                          }
                        : undefined
                    }
                  >
                    {r.name}
                    {jumpable ? ' ↗' : ''}
                  </span>
                  <span>
                    <span className="pill" style={{ background: meta.bg, color: meta.color }}>
                      {meta.label}
                    </span>
                    　{r.progress}%（預期 {r.expected}%，{formatDelta(r.delta)}）
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="card pad">
          <div className="sec-title" style={{ fontSize: 14 }}>
            專案行事曆 — 排除日
          </div>
          <ul className="meta-list">
            {view.exclusions.length === 0 && (
              <li>
                <span className="muted">尚無排除日</span>
              </li>
            )}
            {view.exclusions.map((x, i) => (
              <li key={`${x.fromDate}-${i}`}>
                <span className="k">
                  {x.fromDate} ~ {x.toDate}
                </span>
                <span>{x.reason ?? '排除日'}</span>
              </li>
            ))}
          </ul>
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            客戶反應需排除的作業 / 會議日期，排程將避開並於甘特圖標示。
          </div>
        </div>
      </div>

      {layout.showSecondaryChrome && (
        <p className="muted" style={{ marginTop: 12, fontSize: '12.5px' }}>
          提示：點「簡報模式」或按 F／P 鍵可放大畫面供會議簡報，按 Esc 退出。簡報模式僅切換版面，不影響資料。
        </p>
      )}
    </section>
  );
}

/** 甘特圖本體（月份刻度 + 流程長條 + 完成填色 + 今日線 + 排除日網底），對齊 prototype .gantt 標記。 */
function Chart(props: {
  data: ProjectGanttData;
  rowHeightPx: number;
  onSelectCase?: (caseId: string) => void;
}): JSX.Element {
  const { data, rowHeightPx, onSelectCase } = props;
  const { view } = data;
  const pct = (n: number): string => `${(n * 100).toFixed(2)}%`;

  const bands = (
    <>
      {view.exclusions.map((x, i) => (
        <div
          key={`${x.fromDate}-${i}`}
          className="g-exclude"
          style={{ left: pct(x.startRatio), width: pct(Math.max(x.endRatio - x.startRatio, 0.004)) }}
          title={`${x.reason ?? '排除日'}（${x.fromDate} ~ ${x.toDate}）`}
        />
      ))}
      {view.today.inRange && (
        <div className="g-today" style={{ left: pct(view.today.ratio) }} title={`今日 ${view.today.date}`}>
          <span className="dot" />
        </div>
      )}
    </>
  );

  return (
    <div>
      <div className="g-head">
        <div />
        <div className="g-months">
          {view.axis.months.map((m) => (
            <span key={m.key} className="g-month" style={{ left: pct(m.startRatio) }}>
              {m.label}
            </span>
          ))}
        </div>
      </div>
      <div className="gantt">
        {view.rows.map((r) => {
          const meta = statusMeta(r.status);
          const widthRatio = Math.max(r.endRatio - r.startRatio, 0.006);
          const jumpable = rowJumpable(r, onSelectCase);
          const jump = jumpable ? () => onSelectCase!(r.caseId as string) : undefined;
          return (
            <div key={r.id} className="g-row">
              <div
                className="g-label"
                style={jumpable ? { cursor: 'pointer' } : undefined}
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
                <span style={jumpable ? { color: 'var(--brand)', fontWeight: 600 } : undefined}>
                  {r.name}
                  {jumpable ? ' ↗' : ''}
                </span>
                <span className="muted" style={{ fontSize: 11 }}>
                  {r.planStart} ~ {r.planEnd}
                </span>
              </div>
              <div className="g-track" style={{ height: rowHeightPx }}>
                {bands}
                <div
                  className="g-bar"
                  style={{ left: pct(r.startRatio), width: pct(widthRatio), borderColor: meta.color }}
                  title={`${r.name}：進度 ${r.progress}%（預期 ${r.expected}%，差異 ${formatDelta(r.delta)}）`}
                >
                  <div className="fill" style={{ width: pct(r.fillRatio) }} />
                  <span className="pct">{r.progress}%</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
