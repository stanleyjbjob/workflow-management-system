/**
 * 專案甘特圖 / 簡報模式呈現用型別（§5.2 / §5.5）。
 *
 * 這些型別是後端 `apps/api/src/projects/gantt-engine.ts` 之 `GanttView` 輸出結構的
 * **前端呈現用對應**（刻意以結構複製、與後端型別解耦，與 reminder/onboarding 跨模組解耦同風格）。
 * 後端引擎輸出 0..1 的比例（startRatio/endRatio/ratio/fillRatio）與狀態 / KPI，
 * 前端僅依比例繪製像素，不重算業務邏輯。
 *
 * 待 REST 層（後續 API 任務）就緒後，前端改以 fetch 取得相同結構即可；
 * 本輪先以 seed 範例資料驅動 UI（簡報模式不影響任何資料）。
 */

/** 流程狀態（與後端 gantt-engine GanttFlowStatus 對齊）。 */
export type GanttFlowStatus = 'COMPLETED' | 'NOT_STARTED' | 'DELAYED' | 'AHEAD' | 'ON_TIME';

/** 月份刻度。 */
export interface GanttMonthTick {
  key: string;
  label: string;
  year: number;
  month: number;
  startRatio: number;
}

/** 時間軸。 */
export interface GanttAxis {
  start: string;
  end: string;
  totalDays: number;
  months: GanttMonthTick[];
}

/** 今日基準線。 */
export interface GanttTodayLine {
  date: string;
  ratio: number;
  inRange: boolean;
}

/** 甘特圖單列（一個流程）。 */
export interface GanttRow {
  id: string;
  caseId: string | null;
  flowType: string | null;
  name: string;
  planStart: string;
  planEnd: string;
  startRatio: number;
  endRatio: number;
  progress: number;
  fillRatio: number;
  expected: number;
  delta: number;
  status: GanttFlowStatus;
}

/** 排除日網底。 */
export interface GanttExclusionBand {
  fromDate: string;
  toDate: string;
  reason: string | null;
  source: string | null;
  startRatio: number;
  endRatio: number;
}

/** KPI。 */
export interface GanttKpis {
  overallProgress: number;
  delayedCount: number;
  aheadCount: number;
  onTimeCount: number;
  completedCount: number;
  notStartedCount: number;
  exclusionRangeCount: number;
}

/** 甘特圖完整輸出（後端引擎輸出之前端鏡像）。 */
export interface GanttView {
  axis: GanttAxis;
  today: GanttTodayLine;
  rows: GanttRow[];
  exclusions: GanttExclusionBand[];
  kpis: GanttKpis;
}

/** 專案表頭（簡報重點資訊）。 */
export interface ProjectHeader {
  code: string;
  name: string;
  client: string;
  planStart: string;
  planEnd: string;
}

/** 專案甘特圖呈現資料（表頭 + 甘特視圖）。 */
export interface ProjectGanttData {
  project: ProjectHeader;
  view: GanttView;
}
