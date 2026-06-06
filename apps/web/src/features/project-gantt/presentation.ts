/**
 * 簡報模式 / 甘特呈現純邏輯（issue #27，5.5；對應專案管理模組規格 §5.4、§10.6）。
 *
 * **純邏輯**：不依賴 DOM / React，可被 vitest 純函式測試（與 workflow-designer 的 designer.ts 同風格）。
 *
 * 核心精神：簡報模式只是「呈現版面」的切換——隱藏側欄等次要介面、放大時間軸與重點資訊，
 * **絕不改動任何專案 / 流程資料**。因此本檔所有函式皆為純讀取 / 推導，輸入資料一律不被變動。
 */

import type { GanttFlowStatus, GanttKpis, GanttView } from './types';

/** 檢視模式。 */
export type ViewMode = 'NORMAL' | 'PRESENTATION';

/** 簡報 / 一般版面參數（由模式推導，交給元件套用樣式）。 */
export interface PresentationLayout {
  mode: ViewMode;
  /** 是否顯示側欄（流程清單 / 篩選 / 設定等次要介面）。簡報模式隱藏。 */
  showSidebar: boolean;
  /** 是否顯示次要工具列 / 說明文字等 chrome。簡報模式隱藏。 */
  showSecondaryChrome: boolean;
  /** 是否進入沉浸（全螢幕）呈現。 */
  immersive: boolean;
  /** 重點資訊字級倍率（簡報放大）。 */
  fontScale: number;
  /** 甘特長條列高（px，簡報放大以利會議遠距觀看）。 */
  rowHeightPx: number;
  /** 時間軸區最小高度（px）。 */
  timelineMinHeightPx: number;
}

const NORMAL_LAYOUT: PresentationLayout = {
  mode: 'NORMAL',
  showSidebar: true,
  showSecondaryChrome: true,
  immersive: false,
  fontScale: 1,
  rowHeightPx: 30,
  timelineMinHeightPx: 240,
};

const PRESENTATION_LAYOUT: PresentationLayout = {
  mode: 'PRESENTATION',
  showSidebar: false,
  showSecondaryChrome: false,
  immersive: true,
  fontScale: 1.5,
  rowHeightPx: 48,
  timelineMinHeightPx: 420,
};

/** 是否為簡報模式。 */
export function isPresentation(mode: ViewMode): boolean {
  return mode === 'PRESENTATION';
}

/** 由模式推導版面參數（回傳凍結副本，呼叫端不可變動共享常數）。 */
export function derivePresentationLayout(mode: ViewMode): PresentationLayout {
  return { ...(mode === 'PRESENTATION' ? PRESENTATION_LAYOUT : NORMAL_LAYOUT) };
}

/** 一鍵切換：NORMAL ↔ PRESENTATION。 */
export function toggleMode(mode: ViewMode): ViewMode {
  return mode === 'PRESENTATION' ? 'NORMAL' : 'PRESENTATION';
}

/**
 * 鍵盤事件對應的下一個模式。
 * - Esc：永遠退出簡報（回 NORMAL）。
 * - F / P（不分大小寫）：切換模式（進入 / 退出）。
 * - 其他鍵：回 null（不處理，呼叫端應忽略）。
 */
export function presentationKeydown(key: string, current: ViewMode): ViewMode | null {
  if (key === 'Escape') return 'NORMAL';
  const k = key.toLowerCase();
  if (k === 'f' || k === 'p') return toggleMode(current);
  return null;
}

/** 狀態顯示資訊（繁中標籤 + 顏色，供膠囊 / 長條著色）。 */
export interface StatusMeta {
  label: string;
  /** 長條主色。 */
  color: string;
  /** 膠囊背景（淡）。 */
  bg: string;
}

const STATUS_META: Record<GanttFlowStatus, StatusMeta> = {
  COMPLETED: { label: '已完成', color: '#2563eb', bg: '#eff6ff' },
  ON_TIME: { label: '準時', color: '#16a34a', bg: '#f0fdf4' },
  AHEAD: { label: '超前', color: '#0d9488', bg: '#f0fdfa' },
  DELAYED: { label: '延遲', color: '#dc2626', bg: '#fef2f2' },
  NOT_STARTED: { label: '未開始', color: '#94a3b8', bg: '#f1f5f9' },
};

/** 取狀態顯示資訊。 */
export function statusMeta(status: GanttFlowStatus): StatusMeta {
  return STATUS_META[status];
}

/** 差異（delta，百分點）格式化：+N / -N / 0。 */
export function formatDelta(delta: number): string {
  const r = Math.round(delta);
  if (r > 0) return `+${r}`;
  return `${r}`;
}

/** KPI 卡片（呈現用）。 */
export interface KpiCard {
  key: string;
  label: string;
  value: string;
  /** 著色傾向，供元件選色。 */
  tone: 'primary' | 'good' | 'warn' | 'muted';
  /** 是否為簡報模式應放大強調的重點卡。 */
  highlight: boolean;
}

/**
 * 由 KPI 推導卡片清單（純讀取，不變動輸入）。
 * 重點卡（highlight）：整體進度、延遲數——簡報模式優先放大這些「會議最關心」的數字。
 */
export function buildKpiCards(kpis: GanttKpis): KpiCard[] {
  return [
    {
      key: 'overall',
      label: '整體進度',
      value: `${kpis.overallProgress}%`,
      tone: 'primary',
      highlight: true,
    },
    {
      key: 'delayed',
      label: '延遲流程',
      value: `${kpis.delayedCount}`,
      tone: kpis.delayedCount > 0 ? 'warn' : 'muted',
      highlight: true,
    },
    { key: 'ahead', label: '超前流程', value: `${kpis.aheadCount}`, tone: 'good', highlight: false },
    {
      key: 'ontime',
      label: '準時流程',
      value: `${kpis.onTimeCount}`,
      tone: 'good',
      highlight: false,
    },
    {
      key: 'completed',
      label: '已完成流程',
      value: `${kpis.completedCount}`,
      tone: 'primary',
      highlight: false,
    },
    {
      key: 'notStarted',
      label: '未開始流程',
      value: `${kpis.notStartedCount}`,
      tone: 'muted',
      highlight: false,
    },
    {
      key: 'exclusion',
      label: '排除日區間',
      value: `${kpis.exclusionRangeCount}`,
      tone: 'muted',
      highlight: false,
    },
  ];
}

/**
 * 依模式挑選要呈現的 KPI 卡：
 * - 簡報模式：僅保留重點卡（highlight），聚焦會議關心的數字。
 * - 一般模式：呈現全部卡片。
 * 回傳新陣列，不變動輸入。
 */
export function selectKpiCards(kpis: GanttKpis, mode: ViewMode): KpiCard[] {
  const all = buildKpiCards(kpis);
  return mode === 'PRESENTATION' ? all.filter((c) => c.highlight) : all;
}

/**
 * 簡報用一句話摘要（重點資訊放大呈現）。例：「整體進度 62%，3 個流程延遲」。
 * 純讀取，不變動輸入。
 */
export function presentationHeadline(view: GanttView): string {
  const { kpis } = view;
  const parts = [`整體進度 ${kpis.overallProgress}%`];
  if (kpis.delayedCount > 0) parts.push(`${kpis.delayedCount} 個流程延遲`);
  else if (kpis.aheadCount > 0) parts.push(`${kpis.aheadCount} 個流程超前`);
  else parts.push('進度大致準時');
  return parts.join('，');
}
