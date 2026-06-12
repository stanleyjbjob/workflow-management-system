/**
 * 假日維護 REST 串接（issue 8.14 #49；後端 8.1 第 3 批 calendar.controller.ts）。
 *
 * 路由：
 * - GET    /calendar/holidays?from=&to=&type=   假日／補班清單（日期升冪；全角色可讀）
 * - POST   /calendar/holidays                   新增（admin:manage，僅 MANAGER）
 * - PATCH  /calendar/holidays/:id               部分更新（同上）
 * - DELETE /calendar/holidays/:id               刪除（同上）
 *
 * 查詢參數組裝（holidayQuery）為純函式，可被 vitest 直接測試。
 */
import { apiDelete, apiGet, apiPatch, apiPost, buildQuery } from '../../lib/api';
import type { HolidayRecord, HolidaySourceCode, HolidayTypeCode } from './types';

/** `GET /calendar/holidays` 查詢參數（yyyy-mm-dd 字串；空值不送）。 */
export interface HolidayFilterQuery {
  from?: string | null;
  to?: string | null;
  /** HOLIDAY / MAKEUP_WORKDAY；空字串視同不過濾。 */
  type?: string | null;
}

/** 組 /calendar/holidays query string（純函式）。 */
export function holidayQuery(q: HolidayFilterQuery = {}): string {
  return buildQuery({ from: q.from, to: q.to, type: q.type });
}

/** 新增／更新之請求 body（與後端 controller body 形狀一致）。 */
export interface HolidayPayload {
  /** yyyy-mm-dd。 */
  date: string;
  name: string;
  type: HolidayTypeCode;
  source: HolidaySourceCode;
  note: string | null;
}

/** 取得假日／補班清單（日期升冪）。 */
export function fetchHolidays(q: HolidayFilterQuery = {}): Promise<HolidayRecord[]> {
  return apiGet<HolidayRecord[]>(`/calendar/holidays${holidayQuery(q)}`);
}

/** 新增一筆假日／補班（僅 MANAGER；日期重複→400 holiday_date_duplicate）。 */
export function createHoliday(payload: HolidayPayload): Promise<HolidayRecord> {
  return apiPost<HolidayRecord>('/calendar/holidays', payload);
}

/** 更新一筆假日／補班（部分更新；查無→404）。 */
export function patchHoliday(id: string, patch: Partial<HolidayPayload>): Promise<HolidayRecord> {
  return apiPatch<HolidayRecord>(`/calendar/holidays/${encodeURIComponent(id)}`, patch);
}

/** 刪除一筆假日／補班（查無→404）。 */
export function deleteHoliday(id: string): Promise<{ id: string }> {
  return apiDelete<{ id: string }>(`/calendar/holidays/${encodeURIComponent(id)}`);
}
