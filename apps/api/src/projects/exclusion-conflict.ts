/**
 * 排除日 × 流程計畫區間「衝突偵測」純引擎（§5.4 / #26，規格 §9-6）。
 *
 * 業務裁示（2026-06-06，專案負責人）：
 * - §9-6 採 **A 案**：排除日**不自動順延** `ProjectFlow.planEnd`。改為偵測「排除日區間落入流程計畫
 *   區間」時回報**衝突警示**（哪條流程、撞到哪些排除日、重疊區間與天數），由使用者於 UI 自行決定是否延期。
 * - §9-5：排除日維持**全專案**層級（`Exclusion` 僅綁 `projectId`，不分流程），故此處對專案內每條流程逐一比對。
 *
 * **純邏輯**：不依賴 DB / Nest / Prisma（與 exclusion-engine / gantt-engine / delay-engine 同風格），可純函式測試。
 * 日界一律以 **UTC 午夜** 判斷（與 calendar/gantt/exclusion 引擎一致，避免時區跨日誤差）。
 * 重疊採**含端點**（與 isDateExcluded、CalendarService.getProjectExclusionPredicate 語意一致）：
 * 排除日 [from,to] 與流程 [planStart,planEnd] 只要有任一共同日（含端點）即視為衝突。
 */

import { ExclusionEngineError, ExclusionSourceValue } from './exclusion-engine';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 解析並正規化為「UTC 午夜」Date；非法拋 invalid_date（沿用 exclusion-engine 之錯誤碼）。 */
function toUtcDay(value: Date | string, field: string): Date {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new ExclusionEngineError('invalid_date', `${field} 不是合法日期：${String(value)}`);
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** 流程計畫區間輸入（取自 ProjectFlow）。 */
export interface FlowIntervalInput {
  flowId: string;
  name?: string | null;
  flowType?: string | null;
  planStart: Date | string;
  planEnd: Date | string;
}

/** 排除日輸入（取自 Exclusion；假設已於寫入時通過 exclusion-engine 驗證，此處仍防禦性檢查 from<=to）。 */
export interface ExclusionRangeInput {
  exclusionId?: string;
  fromDate: Date | string;
  toDate: Date | string;
  reason?: string | null;
  source?: ExclusionSourceValue | string | null;
}

/** 單一排除日與某流程的重疊明細。 */
export interface ConflictingExclusion {
  exclusionId?: string;
  fromDate: Date;
  toDate: Date;
  reason?: string | null;
  source?: ExclusionSourceValue | string | null;
  /** 重疊區間（UTC 午夜，含端點）。 */
  overlapFrom: Date;
  overlapTo: Date;
  /** 重疊涵蓋的曆日數（含端點，至少 1）。 */
  overlapCalendarDays: number;
}

/** 某流程的衝突警示（含與其相撞的所有排除日）。 */
export interface FlowExclusionConflict {
  flowId: string;
  name?: string | null;
  flowType?: string | null;
  planStart: Date;
  planEnd: Date;
  conflicts: ConflictingExclusion[];
  /** 落在此流程區間內、被排除日涵蓋的曆日數（多筆排除日相互重疊時取**聯集**去重，非單純相加）。 */
  overlapCalendarDays: number;
}

/** 計算多個重疊區間（[fromMs,toMs] 含端點、日粒度）的聯集天數，避免重疊排除日重複計數。 */
function unionCalendarDays(intervals: readonly (readonly [number, number])[]): number {
  if (intervals.length === 0) return 0;
  const sorted = intervals.map((i) => [i[0], i[1]] as [number, number]).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curFrom = sorted[0][0];
  let curTo = sorted[0][1];
  for (let i = 1; i < sorted.length; i += 1) {
    const [f, t] = sorted[i];
    // 相鄰（差一天）亦合併，因日粒度含端點
    if (f <= curTo + DAY_MS) {
      if (t > curTo) curTo = t;
    } else {
      total += (curTo - curFrom) / DAY_MS + 1;
      curFrom = f;
      curTo = t;
    }
  }
  total += (curTo - curFrom) / DAY_MS + 1;
  return total;
}

/**
 * 偵測專案內各流程與排除日的重疊衝突。
 * 預設只回傳「至少有一筆衝突」的流程；`includeFlowsWithoutConflict` 為 true 時回傳全部流程（conflicts 可能為空）。
 * 流程 planEnd 早於 planStart、或排除日 toDate 早於 fromDate 時拋 `invalid_range`（防禦性，正常資料不會發生）。
 */
export function detectExclusionConflicts(
  flows: readonly FlowIntervalInput[],
  exclusions: readonly ExclusionRangeInput[],
  options: { includeFlowsWithoutConflict?: boolean } = {},
): FlowExclusionConflict[] {
  const exs = exclusions.map((x) => {
    const fromDate = toUtcDay(x.fromDate, 'fromDate');
    const toDate = toUtcDay(x.toDate, 'toDate');
    if (toDate.getTime() < fromDate.getTime()) {
      throw new ExclusionEngineError('invalid_range', '排除日 toDate 不可早於 fromDate');
    }
    return { ...x, fromDate, toDate };
  });

  const result: FlowExclusionConflict[] = [];
  for (const fl of flows) {
    const planStart = toUtcDay(fl.planStart, 'planStart');
    const planEnd = toUtcDay(fl.planEnd, 'planEnd');
    if (planEnd.getTime() < planStart.getTime()) {
      throw new ExclusionEngineError('invalid_range', `流程 ${fl.flowId} planEnd 不可早於 planStart`);
    }

    const conflicts: ConflictingExclusion[] = [];
    const overlapIntervals: [number, number][] = [];
    for (const x of exs) {
      const overlapFromMs = Math.max(planStart.getTime(), x.fromDate.getTime());
      const overlapToMs = Math.min(planEnd.getTime(), x.toDate.getTime());
      if (overlapFromMs <= overlapToMs) {
        conflicts.push({
          exclusionId: x.exclusionId,
          fromDate: x.fromDate,
          toDate: x.toDate,
          reason: x.reason,
          source: x.source,
          overlapFrom: new Date(overlapFromMs),
          overlapTo: new Date(overlapToMs),
          overlapCalendarDays: (overlapToMs - overlapFromMs) / DAY_MS + 1,
        });
        overlapIntervals.push([overlapFromMs, overlapToMs]);
      }
    }

    if (conflicts.length > 0 || options.includeFlowsWithoutConflict) {
      result.push({
        flowId: fl.flowId,
        name: fl.name,
        flowType: fl.flowType,
        planStart,
        planEnd,
        conflicts,
        overlapCalendarDays: unionCalendarDays(overlapIntervals),
      });
    }
  }
  return result;
}

/** 專案內是否存在任一排除日與流程計畫區間衝突（供 UI 快速判斷是否顯示警示）。 */
export function hasAnyExclusionConflict(
  flows: readonly FlowIntervalInput[],
  exclusions: readonly ExclusionRangeInput[],
): boolean {
  return detectExclusionConflicts(flows, exclusions).length > 0;
}
