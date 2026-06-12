/**
 * 假日維護 純展示／驗證邏輯（issue 8.14 #49；無 fetch/DOM 相依，供 vitest 直接測試）。
 *
 * - 過濾預設值（defaultFilter）：當年度 1/1 ~ 12/31（UTC 日界，與後端 toIsoDate 一致）。
 * - 表單驗證（validateDraft）鏡像後端錯誤碼：holiday_date_invalid / holiday_name_required，
 *   讓多數錯誤在送出前就地擋下；後端仍為最終權威（重複日期等仍靠 400 回應）。
 * - 寫入錯誤碼 → 中文提示（writeErrorMessage）：issue 驗收要求的三個錯誤碼＋403。
 */
import type { HolidayFilterQuery, HolidayPayload } from './api';
import type { HolidayRecord, HolidaySourceCode, HolidayTypeCode } from './types';

/** 類型代碼 → 顯示名稱。 */
export const TYPE_LABELS: Record<HolidayTypeCode, string> = {
  HOLIDAY: '假日',
  MAKEUP_WORKDAY: '補班',
};

/** 來源代碼 → 顯示名稱。 */
export const SOURCE_LABELS: Record<HolidaySourceCode, string> = {
  GOVERNMENT: '政府行事曆',
  COMPANY: '公司自訂',
};

/** 類型顯示名稱（未知代碼原樣回傳）。 */
export function typeLabel(code: string): string {
  return (TYPE_LABELS as Record<string, string>)[code] ?? code;
}

/** 來源顯示名稱（未知代碼原樣回傳）。 */
export function sourceLabel(code: string): string {
  return (SOURCE_LABELS as Record<string, string>)[code] ?? code;
}

/** ISO 字串（含時間）→ yyyy-mm-dd（後端 date 為 UTC 午夜，直接取前 10 碼）。 */
export function isoDateOf(value: string): string {
  return value.length >= 10 ? value.slice(0, 10) : value;
}

/** 某年度之 from/to（yyyy-01-01 ~ yyyy-12-31）。 */
export function yearRange(year: number): { from: string; to: string } {
  const y = String(year).padStart(4, '0');
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

/** 過濾列狀態（受控表單值；type 空字串＝不過濾）。 */
export interface HolidayFilterState {
  from: string;
  to: string;
  type: '' | HolidayTypeCode;
}

/** 預設過濾：today（UTC）所在年度全年、全部類型。 */
export function defaultFilter(today: Date = new Date()): HolidayFilterState {
  const { from, to } = yearRange(today.getUTCFullYear());
  return { from, to, type: '' };
}

/** 過濾狀態 → API 查詢參數（空字串略過交給 buildQuery）。 */
export function toHolidayQuery(f: HolidayFilterState): HolidayFilterQuery {
  return { from: f.from, to: f.to, type: f.type };
}

/** 新增／編輯表單草稿（皆為受控字串值）。 */
export interface HolidayDraft {
  date: string;
  name: string;
  type: HolidayTypeCode;
  source: HolidaySourceCode;
  note: string;
}

/** 空白草稿（新增用）。 */
export function emptyDraft(): HolidayDraft {
  return { date: '', name: '', type: 'HOLIDAY', source: 'GOVERNMENT', note: '' };
}

/** 由既有資料列建立編輯草稿。 */
export function draftFromRecord(r: HolidayRecord): HolidayDraft {
  return {
    date: isoDateOf(r.date),
    name: r.name,
    type: r.type === 'MAKEUP_WORKDAY' ? 'MAKEUP_WORKDAY' : 'HOLIDAY',
    source: r.source === 'COMPANY' ? 'COMPANY' : 'GOVERNMENT',
    note: r.note ?? '',
  };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 草稿驗證結果。 */
export type DraftValidation =
  | { ok: true; payload: HolidayPayload }
  | { ok: false; code: 'holiday_date_invalid' | 'holiday_name_required' };

/**
 * 驗證草稿並轉為 API payload（鏡像後端規則）：
 * - date 必為 yyyy-mm-dd 且為真實存在日期（2026-02-30 → invalid）。
 * - name trim 後必填。
 */
export function validateDraft(draft: HolidayDraft): DraftValidation {
  const date = draft.date.trim();
  if (!ISO_DATE_RE.test(date) || Number.isNaN(new Date(`${date}T00:00:00.000Z`).getTime())) {
    return { ok: false, code: 'holiday_date_invalid' };
  }
  // 月日逐欄回驗（Date 對 02-30 會進位成 03-02 而非 NaN 的引擎差異防護）。
  const d = new Date(`${date}T00:00:00.000Z`);
  const [y, m, day] = date.split('-').map(Number);
  if (d.getUTCFullYear() !== y || d.getUTCMonth() + 1 !== m || d.getUTCDate() !== day) {
    return { ok: false, code: 'holiday_date_invalid' };
  }
  const name = draft.name.trim();
  if (name === '') return { ok: false, code: 'holiday_name_required' };
  const note = draft.note.trim();
  return {
    ok: true,
    payload: { date, name, type: draft.type, source: draft.source, note: note === '' ? null : note },
  };
}

/** 寫入錯誤碼 → 中文提示（issue 驗收三碼＋403；其餘回傳 fallback）。 */
export function writeErrorMessage(code: string, fallback: string): string {
  switch (code) {
    case 'holiday_date_duplicate':
      return '該日期已有假日／補班設定（同日僅一筆），請改為編輯既有資料。';
    case 'holiday_date_invalid':
      return '日期格式不正確，請使用 yyyy-mm-dd 的真實日期。';
    case 'holiday_name_required':
      return '名稱必填，請輸入假日／補班名稱。';
    case 'forbidden':
      return '權限不足：僅主管（MANAGER）可維護假日／補班。';
    default:
      return fallback;
  }
}
