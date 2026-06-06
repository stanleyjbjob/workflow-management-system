/**
 * 延遲／超前計算引擎（§5.3 / 專案管理模組規格 §4.2–§4.4）。
 *
 * **純邏輯**：不依賴 DB / Nest / Prisma / CalendarService，可被純函式測試
 * （與 2.x / 3.x / 4.x / 5.1 / 5.2 同風格）。本引擎在 5.2 甘特圖引擎之上，
 * 把「預期 vs 實際」的差異從『百分點』再換算成『天數』，並支援：
 *   1. 五種狀態判斷（完成 / 未開始 / 延遲 / 超前 / 準時）——直接重用 gantt-engine 的
 *      `expectedProgress`（§4.2 線性預期）與 `classifyFlowStatus`（§4.3 delta 與門檻 T），
 *      確保與甘特圖呈現完全一致。
 *   2. 依「流程型別」套用不同的容許門檻 T（§4.3 / §9-2：不同流程可有不同寬容度）。
 *   3. 差異天數可選「日曆日」或「工作日」基準（§9-3 待釐清：以日曆日或工作日計算）。
 *      工作日基準透過注入 `workdayCounter` 計算（由 CalendarService 提供 businessDaysBetween），
 *      引擎本身不耦合行事曆實作（與 reminder-engine 解耦策略一致）。
 *
 * 設計取捨：差異天數 = (deltaPercent / 100) × 計畫工期（所選基準）。
 *   - 符號與 deltaPercent 一致：正值＝超前、負值＝落後（delayDays 另以正值表達「落後幾天」）。
 *   - 以「進度落差換算工期天數」呈現，直觀回答『大約落後幾天進度』，可純函式測試且與 §4.2/§4.3 一致。
 *   - 完成 / 未開始流程的差異天數一律歸零（見 evaluateFlowDelay）。
 *
 * 日界一律以 UTC 判斷（與 4.1 calendar-engine / 5.1 project-engine / 5.2 gantt-engine 一致）。
 */

import {
  DEFAULT_TOLERANCE_THRESHOLD,
  type GanttFlowStatus,
  classifyFlowStatus,
  expectedProgress,
  toIsoDate,
} from './gantt-engine';

/** 引擎錯誤（帶可程式判讀的 code）。 */
export class DelayEngineError extends Error {
  constructor(
    readonly code: 'invalid_date' | 'invalid_range' | 'invalid_threshold' | 'workday_counter_required',
    message: string,
  ) {
    super(message);
    this.name = 'DelayEngineError';
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 解析日期（UTC 基準），非法拋 invalid_date。 */
function parseDate(value: Date | string, field: string): Date {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new DelayEngineError('invalid_date', `${field} 不是合法日期：${String(value)}`);
  }
  return d;
}

/** 取 UTC 當日 0 時。 */
function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** 差異天數基準。 */
export type DayBasis = 'CALENDAR' | 'WORKDAY';

/**
 * 工作日計數器：回傳 [from, to] 計畫期間內的工作日數（扣除假日／週末）。
 * 由 CalendarService 注入（通常以 calendar-engine `businessDaysBetween` 實作），
 * 引擎不直接相依行事曆，以維持純函式可測性與跨模組解耦。
 */
export type WorkdayCounter = (from: Date, to: Date) => number;

/**
 * 依流程型別設定的容許門檻 T（百分點）。
 * - `default`：未對應到 byFlowType 時的預設門檻。
 * - `byFlowType`：個別流程型別覆寫（如「環境建置」較寬鬆、「銷售」較嚴格）。
 * §9-2 待主管定案前，以單一預設值兜底。
 */
export interface FlowTypeThresholdConfig {
  default: number;
  byFlowType?: Readonly<Record<string, number>>;
}

/** 預設門檻設定：沿用 5.2 的 DEFAULT_TOLERANCE_THRESHOLD（±8 百分點），無流程型別覆寫。 */
export const DEFAULT_FLOWTYPE_THRESHOLDS: FlowTypeThresholdConfig = Object.freeze({
  default: DEFAULT_TOLERANCE_THRESHOLD,
});

/** 將 thresholds 參數正規化為 FlowTypeThresholdConfig（數字＝統一門檻）。 */
function normalizeThresholds(input?: FlowTypeThresholdConfig | number): FlowTypeThresholdConfig {
  if (input == null) return DEFAULT_FLOWTYPE_THRESHOLDS;
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) {
      throw new DelayEngineError('invalid_threshold', `容許門檻 T 必須為非負數：${String(input)}`);
    }
    return { default: input };
  }
  if (!Number.isFinite(input.default) || input.default < 0) {
    throw new DelayEngineError('invalid_threshold', `預設容許門檻 T 必須為非負數：${String(input.default)}`);
  }
  for (const [k, v] of Object.entries(input.byFlowType ?? {})) {
    if (!Number.isFinite(v) || v < 0) {
      throw new DelayEngineError('invalid_threshold', `流程型別「${k}」的容許門檻 T 必須為非負數：${String(v)}`);
    }
  }
  return input;
}

/**
 * 解析某流程型別應使用的容許門檻 T。
 * 命中 byFlowType 用其值，否則回 default。
 */
export function resolveThreshold(
  flowType: string | null | undefined,
  config: FlowTypeThresholdConfig | number = DEFAULT_FLOWTYPE_THRESHOLDS,
): number {
  const cfg = normalizeThresholds(config);
  if (flowType != null && cfg.byFlowType && Object.prototype.hasOwnProperty.call(cfg.byFlowType, flowType)) {
    return cfg.byFlowType[flowType];
  }
  return cfg.default;
}

/** 單一流程的延遲／超前輸入（與 Prisma ProjectFlow 對齊但解耦其型別）。 */
export interface DelayInput {
  id?: string;
  caseId?: string | null;
  flowType?: string | null;
  name?: string | null;
  planStart: Date | string;
  planEnd: Date | string;
  /** 實際完成比例 0..100。 */
  progress: number;
}

/** 計算選項。 */
export interface DelayOptions {
  /** 評估基準時間（今日），預設 new Date()。 */
  now?: Date | string;
  /** 容許門檻：數字＝統一 T；物件＝可依流程型別覆寫。預設 ±8。 */
  thresholds?: FlowTypeThresholdConfig | number;
  /** 差異天數基準，預設 CALENDAR（日曆日）。 */
  basis?: DayBasis;
  /** WORKDAY 基準時必須提供，否則拋 workday_counter_required。 */
  workdayCounter?: WorkdayCounter;
}

/** 單一流程的延遲／超前評估結果。 */
export interface DelayEvaluation {
  id: string | null;
  caseId: string | null;
  flowType: string | null;
  name: string | null;
  planStart: string;
  planEnd: string;
  /** 預期進度 0..100（§4.2）。 */
  expected: number;
  /** 實際進度 0..100。 */
  actual: number;
  /** 差異百分比 = 實際 − 預期（百分點，正＝超前 / 負＝落後）。 */
  deltaPercent: number;
  /** 五種狀態（§4.3）。 */
  status: GanttFlowStatus;
  /** 實際採用的容許門檻 T（依流程型別解析後）。 */
  thresholdUsed: number;
  /** 差異天數基準。 */
  basis: DayBasis;
  /** 計畫工期（所選基準的天數，至少 1）。 */
  durationDays: number;
  /** 差異天數 = round(deltaPercent/100 × durationDays)，正＝超前 / 負＝落後；完成／未開始為 0。 */
  deltaDays: number;
  /** 落後天數（delta 為負時的絕對值；超前或準時為 0）。供「延遲」直觀呈現。 */
  delayDays: number;
  /** 超前天數（delta 為正時的值；落後或準時為 0）。 */
  aheadDays: number;
}

/** 夾擠並四捨五入為 0..100 整數百分比。 */
function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n);
  if (r < 0) return 0;
  if (r > 100) return 100;
  return r;
}

/** 計算計畫工期天數（所選基準，至少 1）。 */
function planDurationDays(
  planStart: Date,
  planEnd: Date,
  basis: DayBasis,
  workdayCounter?: WorkdayCounter,
): number {
  if (basis === 'WORKDAY') {
    if (!workdayCounter) {
      throw new DelayEngineError('workday_counter_required', 'basis=WORKDAY 時必須提供 workdayCounter');
    }
    const wd = workdayCounter(planStart, planEnd);
    const n = Math.abs(Math.round(wd));
    return n < 1 ? 1 : n;
  }
  const s = startOfUtcDay(planStart).getTime();
  const e = startOfUtcDay(planEnd).getTime();
  const span = Math.round((e - s) / DAY_MS);
  return span < 1 ? 1 : span;
}

/**
 * 計算單一流程的延遲／超前。
 * 重用 5.2 gantt-engine 的 expectedProgress / classifyFlowStatus，確保五種狀態與甘特圖一致；
 * 再依所選基準把差異百分比換算為天數。
 */
export function evaluateFlowDelay(input: DelayInput, options: DelayOptions = {}): DelayEvaluation {
  const now = options.now != null ? parseDate(options.now, 'now') : new Date();
  const basis: DayBasis = options.basis ?? 'CALENDAR';

  const planStart = parseDate(input.planStart, 'planStart');
  const planEnd = parseDate(input.planEnd, 'planEnd');
  if (startOfUtcDay(planEnd).getTime() < startOfUtcDay(planStart).getTime()) {
    throw new DelayEngineError('invalid_range', `流程 ${input.id ?? ''} planEnd 不可早於 planStart`);
  }

  const threshold = resolveThreshold(input.flowType, options.thresholds);
  const actual = clampPercent(input.progress);
  const expected = expectedProgress(planStart, planEnd, now);
  const { status, delta } = classifyFlowStatus({
    progress: actual,
    expected,
    now,
    planStart,
    threshold,
  });

  const durationDays = planDurationDays(planStart, planEnd, basis, options.workdayCounter);
  // 差異天數僅對「進行中」三態（延遲／超前／準時）有意義：
  // 已完成（工作已做完）與未開始（尚未進入計畫期間）一律視為無延遲／超前 → 0 天，
  // 避免完成流程因 delta 偏大而被誤計為「超前 N 天」。deltaPercent 仍保留原始差值供透明檢視。
  const dayApplicable = status === 'DELAYED' || status === 'AHEAD' || status === 'ON_TIME';
  const deltaDays = dayApplicable ? Math.round((delta / 100) * durationDays) : 0;

  return {
    id: (input.id ?? null) || null,
    caseId: (input.caseId ?? null) || null,
    flowType: input.flowType ?? null,
    name: input.name ?? null,
    planStart: toIsoDate(planStart),
    planEnd: toIsoDate(planEnd),
    expected,
    actual,
    deltaPercent: delta,
    status,
    thresholdUsed: threshold,
    basis,
    durationDays,
    deltaDays,
    delayDays: deltaDays < 0 ? -deltaDays : 0,
    aheadDays: deltaDays > 0 ? deltaDays : 0,
  };
}

/** 批次評估多個流程。 */
export function evaluateFlows(
  flows: readonly DelayInput[],
  options: DelayOptions = {},
): DelayEvaluation[] {
  return flows.map((f) => evaluateFlowDelay(f, options));
}

/** 延遲／超前彙總（供狀態清單 / KPI）。 */
export interface DelaySummary {
  total: number;
  completedCount: number;
  notStartedCount: number;
  delayedCount: number;
  aheadCount: number;
  onTimeCount: number;
  /** 最大落後天數（所有流程中 delayDays 的最大值；無則 0）。 */
  maxDelayDays: number;
  /** 最大超前天數。 */
  maxAheadDays: number;
  /** 各流程 deltaDays 總和（淨值，正＝整體超前）。 */
  netDeltaDays: number;
}

/** 彙總一組評估結果。 */
export function summarizeDelays(evaluations: readonly DelayEvaluation[]): DelaySummary {
  let maxDelayDays = 0;
  let maxAheadDays = 0;
  let netDeltaDays = 0;
  for (const e of evaluations) {
    if (e.delayDays > maxDelayDays) maxDelayDays = e.delayDays;
    if (e.aheadDays > maxAheadDays) maxAheadDays = e.aheadDays;
    netDeltaDays += e.deltaDays;
  }
  const countBy = (s: GanttFlowStatus) => evaluations.filter((e) => e.status === s).length;
  return {
    total: evaluations.length,
    completedCount: countBy('COMPLETED'),
    notStartedCount: countBy('NOT_STARTED'),
    delayedCount: countBy('DELAYED'),
    aheadCount: countBy('AHEAD'),
    onTimeCount: countBy('ON_TIME'),
    maxDelayDays,
    maxAheadDays,
    netDeltaDays,
  };
}
