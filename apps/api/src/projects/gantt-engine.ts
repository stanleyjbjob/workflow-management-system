/**
 * 甘特圖與進度呈現引擎（§5.2 / 規格 §5.2、§10.3）。
 *
 * **純邏輯**：不依賴 DB / Nest / Prisma，可被純函式測試（與 2.x / 3.x / 4.x / 5.1 同風格）。
 * 由「專案計畫期間 + 掛載流程清單 + 排除日」推導甘特圖呈現所需的全部幾何與 KPI 資料，
 * 由前端據以繪製：月份刻度、各流程長條與完成比例填色、今日基準線、排除日網底、狀態膠囊。
 *
 * 對應 issue 5.2 驗收要點：
 * - 甘特圖正確呈現區間 / 進度；今日線位置正確。
 * - KPI：整體進度、延遲數、超前數、排除日區間數。
 *
 * 進度狀態（完成 / 未開始 / 延遲 / 超前 / 準時）依規格 §4.2（線性預期進度）與 §4.3（delta 與容許門檻 T）。
 * 注意：本引擎僅輸出「呈現用幾何 + 狀態」純資料；實際排除日順延重算（planEnd 移動）屬 5.4（#26），
 * 此處排除日僅作為甘特圖網底標示與 KPI 區間計數，不在此改動流程 planEnd。
 *
 * 日界一律以 UTC 判斷（與 4.1 calendar-engine / 5.1 project-engine 一致，避免時區跨日誤差）。
 */

/** 引擎錯誤（帶可程式判讀的 code）。 */
export class GanttEngineError extends Error {
  constructor(
    readonly code: 'invalid_date' | 'invalid_range' | 'invalid_threshold',
    message: string,
  ) {
    super(message);
    this.name = 'GanttEngineError';
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 解析日期（UTC 基準），非法拋 invalid_date。 */
function parseDate(value: Date | string, field: string): Date {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new GanttEngineError('invalid_date', `${field} 不是合法日期：${String(value)}`);
  }
  return d;
}

/** 取 UTC 當日 0 時（去除時分秒，使日界一致）。 */
function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** 格式化為 YYYY-MM-DD（UTC）。 */
export function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 流程狀態（規格 §4.3）。 */
export type GanttFlowStatus = 'COMPLETED' | 'NOT_STARTED' | 'DELAYED' | 'AHEAD' | 'ON_TIME';

/** 容許門檻 T 預設值（百分點，規格 §4.3，可由設定覆寫；§9-2 待主管定案）。 */
export const DEFAULT_TOLERANCE_THRESHOLD = 8;

/** 掛載流程輸入（呈現用結構，與 Prisma ProjectFlow 對齊但解耦其型別）。 */
export interface GanttFlowInput {
  id: string;
  caseId?: string | null;
  /** 流程類型字串（銷售 / 系統導入 / 環境建置 / 客製化）；引擎不分支，僅透傳。 */
  flowType?: string | null;
  name: string;
  planStart: Date | string;
  planEnd: Date | string;
  /** 實際完成比例 0..100。 */
  progress: number;
}

/** 排除日輸入（與 Prisma Exclusion 對齊但解耦其型別）。 */
export interface GanttExclusionInput {
  fromDate: Date | string;
  toDate: Date | string;
  reason?: string | null;
  source?: string | null;
}

/** 建立甘特圖參數。 */
export interface BuildGanttParams {
  /** 專案計畫期間；與各流程期間共同決定時間軸範圍。 */
  project: { planStart: Date | string; planEnd: Date | string };
  flows: readonly GanttFlowInput[];
  exclusions?: readonly GanttExclusionInput[];
  /** 評估基準時間（今日線 / 預期進度），預設 new Date()。 */
  now?: Date | string;
  /** 容許門檻 T（百分點），預設 DEFAULT_TOLERANCE_THRESHOLD。 */
  toleranceThreshold?: number;
}

/** 時間軸。 */
export interface GanttAxis {
  start: string; // YYYY-MM-DD（UTC）
  end: string;
  /** 軸跨距（含端點的天數）；至少 1。 */
  totalDays: number;
  months: GanttMonthTick[];
}

/** 月份刻度。 */
export interface GanttMonthTick {
  key: string; // YYYY-MM
  label: string; // YYYY-MM
  year: number;
  month: number; // 1..12
  /** 該月第一天於軸上的位置比例 0..1（夾擠；軸起點之前的月份為 0）。 */
  startRatio: number;
}

/** 今日基準線。 */
export interface GanttTodayLine {
  date: string; // YYYY-MM-DD（UTC）
  /** 位置比例 0..1（夾擠）。 */
  ratio: number;
  /** 今日是否落在軸範圍內（超出時 ratio 會被夾擠至 0 或 1，inRange=false）。 */
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
  /** 長條左端比例 0..1。 */
  startRatio: number;
  /** 長條右端比例 0..1。 */
  endRatio: number;
  /** 完成比例 0..100（實際進度）。 */
  progress: number;
  /** 完成填色比例 0..1（= progress/100，相對於長條寬度）。 */
  fillRatio: number;
  /** 預期進度 0..100（規格 §4.2）。 */
  expected: number;
  /** delta = 實際 − 預期（百分點，規格 §4.3）。 */
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

/** KPI（規格 §5.1 / issue 5.2）。 */
export interface GanttKpis {
  /** 整體進度 = 各流程實際進度平均（無流程回 0）。 */
  overallProgress: number;
  /** 延遲流程數。 */
  delayedCount: number;
  /** 超前流程數。 */
  aheadCount: number;
  /** 準時流程數。 */
  onTimeCount: number;
  /** 已完成流程數。 */
  completedCount: number;
  /** 未開始流程數。 */
  notStartedCount: number;
  /** 排除日區間數。 */
  exclusionRangeCount: number;
}

/** 甘特圖完整輸出。 */
export interface GanttView {
  axis: GanttAxis;
  today: GanttTodayLine;
  rows: GanttRow[];
  exclusions: GanttExclusionBand[];
  kpis: GanttKpis;
}

/** 夾擠 0..1。 */
function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** 夾擠並四捨五入為 0..100 整數百分比。 */
function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n);
  if (r < 0) return 0;
  if (r > 100) return 100;
  return r;
}

/**
 * 計算某日於軸上的位置比例 0..1（以 UTC 日為單位、含端點）。
 * 軸跨距為 0（start===end）時：date < start → 0，否則 1。
 */
export function ratioOf(date: Date, axisStart: Date, axisEnd: Date): number {
  const s = startOfUtcDay(axisStart).getTime();
  const e = startOfUtcDay(axisEnd).getTime();
  const d = startOfUtcDay(date).getTime();
  const span = e - s;
  if (span <= 0) return d < s ? 0 : 1;
  return clamp01((d - s) / span);
}

/**
 * 預期進度（規格 §4.2）：線性 clamp。
 * - now < planStart → 0（未開始）。
 * - now > planEnd → 100。
 * - planStart === planEnd（零工期）：now >= planEnd → 100，否則 0。
 */
export function expectedProgress(planStart: Date, planEnd: Date, now: Date): number {
  const s = startOfUtcDay(planStart).getTime();
  const e = startOfUtcDay(planEnd).getTime();
  const n = startOfUtcDay(now).getTime();
  if (n <= s) return n < s ? 0 : (e <= s ? 100 : 0);
  if (n >= e) return 100;
  const span = e - s;
  if (span <= 0) return 100;
  return clampPercent(((n - s) / span) * 100);
}

/**
 * 流程狀態（規格 §4.3）。
 * 優先序：progress>=100 → 完成；now<planStart → 未開始；否則依 delta 與 T 判斷延遲 / 超前 / 準時。
 */
export function classifyFlowStatus(params: {
  progress: number;
  expected: number;
  now: Date;
  planStart: Date;
  threshold: number;
}): { status: GanttFlowStatus; delta: number } {
  const { progress, expected, now, planStart, threshold } = params;
  const delta = Math.round(progress - expected);
  if (progress >= 100) return { status: 'COMPLETED', delta };
  const n = startOfUtcDay(now).getTime();
  const s = startOfUtcDay(planStart).getTime();
  if (n < s) return { status: 'NOT_STARTED', delta };
  if (delta < -threshold) return { status: 'DELAYED', delta };
  if (delta > threshold) return { status: 'AHEAD', delta };
  return { status: 'ON_TIME', delta };
}

/** 由軸範圍產生月份刻度（每月第一天，UTC）。 */
export function buildMonthTicks(axisStart: Date, axisEnd: Date): GanttMonthTick[] {
  const s = startOfUtcDay(axisStart);
  const e = startOfUtcDay(axisEnd);
  const ticks: GanttMonthTick[] = [];
  let y = s.getUTCFullYear();
  let m = s.getUTCMonth(); // 0..11
  // 從軸起點所在月份開始，逐月推進到軸終點所在月份（含）。
  // 守門：最多 1200 個月（100 年），避免異常輸入無限迴圈。
  for (let guard = 0; guard < 1200; guard++) {
    const first = new Date(Date.UTC(y, m, 1));
    const key = `${y.toString().padStart(4, '0')}-${(m + 1).toString().padStart(2, '0')}`;
    ticks.push({
      key,
      label: key,
      year: y,
      month: m + 1,
      startRatio: ratioOf(first, s, e),
    });
    if (y > e.getUTCFullYear() || (y === e.getUTCFullYear() && m >= e.getUTCMonth())) break;
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return ticks;
}

/** 計算軸跨距天數（含端點，至少 1）。 */
function totalDaysInclusive(start: Date, end: Date): number {
  const s = startOfUtcDay(start).getTime();
  const e = startOfUtcDay(end).getTime();
  if (e <= s) return 1;
  return Math.round((e - s) / DAY_MS) + 1;
}

/**
 * 建立甘特圖呈現資料。
 *
 * 時間軸範圍 = min(專案 planStart, 所有流程 planStart) .. max(專案 planEnd, 所有流程 planEnd)，
 * 確保任何流程長條與今日線都落在軸內（今日線若仍超出則 inRange=false 並夾擠）。
 */
export function buildGantt(params: BuildGanttParams): GanttView {
  const threshold = params.toleranceThreshold ?? DEFAULT_TOLERANCE_THRESHOLD;
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new GanttEngineError('invalid_threshold', `容許門檻 T 必須為非負數：${String(params.toleranceThreshold)}`);
  }
  const now = params.now != null ? parseDate(params.now, 'now') : new Date();

  const projStart = parseDate(params.project.planStart, 'project.planStart');
  const projEnd = parseDate(params.project.planEnd, 'project.planEnd');
  if (startOfUtcDay(projEnd).getTime() < startOfUtcDay(projStart).getTime()) {
    throw new GanttEngineError('invalid_range', '專案 planEnd 不可早於 planStart');
  }

  // 正規化流程日期，並一併推導軸範圍。
  const normFlows = params.flows.map((f) => {
    const planStart = parseDate(f.planStart, `flow(${f.id}).planStart`);
    const planEnd = parseDate(f.planEnd, `flow(${f.id}).planEnd`);
    if (startOfUtcDay(planEnd).getTime() < startOfUtcDay(planStart).getTime()) {
      throw new GanttEngineError('invalid_range', `流程 ${f.id} planEnd 不可早於 planStart`);
    }
    return { ...f, planStart, planEnd };
  });

  let axisStart = startOfUtcDay(projStart);
  let axisEnd = startOfUtcDay(projEnd);
  for (const f of normFlows) {
    if (startOfUtcDay(f.planStart).getTime() < axisStart.getTime()) axisStart = startOfUtcDay(f.planStart);
    if (startOfUtcDay(f.planEnd).getTime() > axisEnd.getTime()) axisEnd = startOfUtcDay(f.planEnd);
  }

  const rows: GanttRow[] = normFlows.map((f) => {
    const expected = expectedProgress(f.planStart, f.planEnd, now);
    const progress = clampPercent(f.progress);
    const { status, delta } = classifyFlowStatus({
      progress,
      expected,
      now,
      planStart: f.planStart,
      threshold,
    });
    return {
      id: f.id,
      caseId: (f.caseId ?? null) || null,
      flowType: f.flowType ?? null,
      name: f.name,
      planStart: toIsoDate(f.planStart),
      planEnd: toIsoDate(f.planEnd),
      startRatio: ratioOf(f.planStart, axisStart, axisEnd),
      endRatio: ratioOf(f.planEnd, axisStart, axisEnd),
      progress,
      fillRatio: clamp01(progress / 100),
      expected,
      delta,
      status,
    };
  });

  const exclusionInputs = params.exclusions ?? [];
  const exclusions: GanttExclusionBand[] = exclusionInputs.map((x) => {
    const from = parseDate(x.fromDate, 'exclusion.fromDate');
    const to = parseDate(x.toDate, 'exclusion.toDate');
    if (startOfUtcDay(to).getTime() < startOfUtcDay(from).getTime()) {
      throw new GanttEngineError('invalid_range', '排除日 toDate 不可早於 fromDate');
    }
    return {
      fromDate: toIsoDate(from),
      toDate: toIsoDate(to),
      reason: (x.reason ?? null) || null,
      source: (x.source ?? null) || null,
      startRatio: ratioOf(from, axisStart, axisEnd),
      endRatio: ratioOf(to, axisStart, axisEnd),
    };
  });

  const nowDay = startOfUtcDay(now).getTime();
  const inRange = nowDay >= axisStart.getTime() && nowDay <= axisEnd.getTime();
  const today: GanttTodayLine = {
    date: toIsoDate(now),
    ratio: ratioOf(now, axisStart, axisEnd),
    inRange,
  };

  const kpis: GanttKpis = {
    overallProgress:
      rows.length === 0 ? 0 : clampPercent(rows.reduce((acc, r) => acc + r.progress, 0) / rows.length),
    delayedCount: rows.filter((r) => r.status === 'DELAYED').length,
    aheadCount: rows.filter((r) => r.status === 'AHEAD').length,
    onTimeCount: rows.filter((r) => r.status === 'ON_TIME').length,
    completedCount: rows.filter((r) => r.status === 'COMPLETED').length,
    notStartedCount: rows.filter((r) => r.status === 'NOT_STARTED').length,
    exclusionRangeCount: exclusions.length,
  };

  return {
    axis: {
      start: toIsoDate(axisStart),
      end: toIsoDate(axisEnd),
      totalDays: totalDaysInclusive(axisStart, axisEnd),
      months: buildMonthTicks(axisStart, axisEnd),
    },
    today,
    rows,
    exclusions,
    kpis,
  };
}
