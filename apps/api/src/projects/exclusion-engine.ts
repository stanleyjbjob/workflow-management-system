/**
 * 專案行事曆排除日引擎（§5.4 / 規格 §3.3、§6.3、§10.5）。
 *
 * **純邏輯**：不依賴 DB / Nest / Prisma，可被純函式測試（與 2.x / 3.x / 4.x / 5.1 / 5.2 同風格）。
 * 負責「排除日輸入的驗證與正規化」以及「某日是否落入排除區間」之純判斷，
 * 由 ProjectService 落實到 Exclusion 資料表、由 CalendarService 組成遞延 predicate（§8.3）。
 *
 * 對應 issue 5.4（#26）「預期行為」：
 * - 新增 / 移除排除日（起、迄、原因、來源）。
 * - 甘特圖以斜線 / 網底標示（已於 5.2 gantt-engine 之 GanttExclusionBand 完成，本引擎不重複）。
 * - 時程計算避開該區間（與國定假日併行，由 CalendarService.getProjectExclusionPredicate 注入）。
 *
 * 日界一律以 UTC 判斷（與 4.1 calendar-engine / 5.1 project-engine / 5.2 gantt-engine 一致，
 * 避免執行環境時區造成跨日誤差）。正規化後之 fromDate / toDate 皆為「UTC 午夜」。
 *
 * source 採與 Prisma `ExclusionSource` 相同的字串值（CUSTOMER / INTERNAL）但於引擎內以字串常數
 * 解耦其型別（沿用 gantt-engine 之解耦風格），服務層再直接交給 Prisma（值相同）。
 *
 * ⚠️ 業務規則待釐清（規格 §9-5 / §9-6，本引擎刻意不臆測）：
 * - 排除日是否區分「全專案」與「特定流程」：目前資料模型 Exclusion 僅有 projectId（全專案）。
 * - 排除日落在流程區間內時，是否自動順延 planEnd（順延工作日數）或僅標示：規格以「建議」表述，
 *   尚未定案；本引擎僅提供判斷與計數，不自動改動任何 planEnd。
 */

/** 引擎錯誤（帶可程式判讀的 code）。 */
export class ExclusionEngineError extends Error {
  constructor(
    readonly code:
      | 'from_required'
      | 'to_required'
      | 'invalid_date'
      | 'invalid_range'
      | 'reason_required'
      | 'invalid_source',
    message: string,
  ) {
    super(message);
    this.name = 'ExclusionEngineError';
  }
}

/** 允許的排除日來源（值與 Prisma ExclusionSource 一致）。 */
export const EXCLUSION_SOURCES = ['CUSTOMER', 'INTERNAL'] as const;
export type ExclusionSourceValue = (typeof EXCLUSION_SOURCES)[number];

/** 排除日輸入（原始，來自 API / 服務層）。 */
export interface ExclusionDraftInput {
  fromDate?: Date | string | null;
  toDate?: Date | string | null;
  reason?: string | null;
  /** 可選；未提供時為 null。 */
  source?: ExclusionSourceValue | string | null;
}

/** 正規化後的排除日（fromDate / toDate 為 UTC 午夜，reason 已 trim，source 為 enum 或 null）。 */
export interface NormalizedExclusion {
  fromDate: Date;
  toDate: Date;
  reason: string;
  source: ExclusionSourceValue | null;
}

/** 解析日期並正規化為「UTC 午夜」Date；非法拋 invalid_date。 */
function parseUtcDay(value: Date | string, field: 'fromDate' | 'toDate'): Date {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new ExclusionEngineError('invalid_date', `${field} 不是合法日期：${String(value)}`);
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** 格式化為 YYYY-MM-DD（UTC）。 */
export function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 正規化 source：空值→null；其餘需為 EXCLUSION_SOURCES 之一，否則拋 invalid_source。 */
export function normalizeSource(source?: ExclusionSourceValue | string | null): ExclusionSourceValue | null {
  if (source == null) return null;
  const s = String(source).trim();
  if (s === '') return null;
  if ((EXCLUSION_SOURCES as readonly string[]).includes(s)) return s as ExclusionSourceValue;
  throw new ExclusionEngineError('invalid_source', `source 必須為 ${EXCLUSION_SOURCES.join(' / ')}：${String(source)}`);
}

/**
 * 驗證並正規化排除日輸入（規格 §3.3）。
 * - fromDate / toDate 必填且為合法日期；toDate 不可早於 fromDate（含當日，故允許 from===to 之單日排除）。
 * - reason 必填且非空白。
 * - source 可選（CUSTOMER / INTERNAL），空值視為 null。
 * 回傳之日期皆為 UTC 午夜，與 calendar / gantt 引擎之日界一致。
 */
export function buildExclusionDraft(input: ExclusionDraftInput): NormalizedExclusion {
  if (input.fromDate == null || input.fromDate === '') {
    throw new ExclusionEngineError('from_required', 'fromDate 為必填');
  }
  if (input.toDate == null || input.toDate === '') {
    throw new ExclusionEngineError('to_required', 'toDate 為必填');
  }
  const fromDate = parseUtcDay(input.fromDate, 'fromDate');
  const toDate = parseUtcDay(input.toDate, 'toDate');
  if (toDate.getTime() < fromDate.getTime()) {
    throw new ExclusionEngineError('invalid_range', `toDate（${toIsoDate(toDate)}）不可早於 fromDate（${toIsoDate(fromDate)}）`);
  }
  const reason = (input.reason ?? '').trim();
  if (reason === '') {
    throw new ExclusionEngineError('reason_required', 'reason 為必填');
  }
  const source = normalizeSource(input.source);
  return { fromDate, toDate, reason, source };
}

/**
 * 套用部分更新到既有排除日（用於編輯）。未提供（undefined）的欄位沿用 current；
 * 提供的欄位以 buildExclusionDraft 同等規則重新驗證（含 from<=to 跨欄位檢查）。
 * source 傳入 null 視為「明確清除」、undefined 視為「不變更」。
 */
export function buildExclusionPatch(
  input: ExclusionDraftInput,
  current: NormalizedExclusion,
): NormalizedExclusion {
  return buildExclusionDraft({
    fromDate: input.fromDate ?? current.fromDate,
    toDate: input.toDate ?? current.toDate,
    reason: input.reason ?? current.reason,
    source: input.source === undefined ? current.source : input.source,
  });
}

/** 排除日區間（正規化）— 與 NormalizedExclusion 結構相容，供純判斷使用。 */
export type ExclusionRange = Pick<NormalizedExclusion, 'fromDate' | 'toDate'>;

/**
 * 某日是否落在任一排除區間內（含端點，UTC 日界）。
 * 與 CalendarService.getProjectExclusionPredicate 之語意一致，可供前端 / 測試共用。
 */
export function isDateExcluded(date: Date, exclusions: readonly ExclusionRange[]): boolean {
  const key = toIsoDate(date instanceof Date ? date : new Date(date));
  return exclusions.some((r) => {
    const from = toIsoDate(r.fromDate instanceof Date ? r.fromDate : new Date(r.fromDate));
    const to = toIsoDate(r.toDate instanceof Date ? r.toDate : new Date(r.toDate));
    return key >= from && key <= to;
  });
}

/**
 * 計算某排除區間涵蓋的曆日數（含端點）。單日排除（from===to）回 1。
 * 注意：此為「曆日」計數；若需「工作日」順延天數，應結合 calendar-engine（§9-6 待釐清，未於本輪自動套用）。
 */
export function exclusionCalendarDays(range: ExclusionRange): number {
  const from = range.fromDate instanceof Date ? range.fromDate : new Date(range.fromDate);
  const to = range.toDate instanceof Date ? range.toDate : new Date(range.toDate);
  const f = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const t = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  const days = Math.round((t - f) / (24 * 60 * 60 * 1000)) + 1;
  return days < 1 ? 1 : days;
}
