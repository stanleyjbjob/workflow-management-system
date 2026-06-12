/**
 * 假日維護 型別鏡像（issue 8.14 #49）。
 *
 * 對應後端 `GET /calendar/holidays`（calendar.controller.ts → CalendarService.listHolidays）：
 * Prisma Holiday 模型 { id, date, name, type, source, note, createdAt, updatedAt }，
 * 日期欄位經 JSON 序列化為 ISO 字串（date 為 @db.Date，固定 UTC 午夜）。
 */

/** 假日類型（schema.prisma HolidayType）。 */
export type HolidayTypeCode = 'HOLIDAY' | 'MAKEUP_WORKDAY';

/** 假日來源（schema.prisma HolidaySource）。 */
export type HolidaySourceCode = 'GOVERNMENT' | 'COMPANY';

/** 一筆假日／補班資料列。type/source 以 string 容忍未知值（顯示原樣）。 */
export interface HolidayRecord {
  id: string;
  /** ISO 字串（UTC 午夜，如 2026-01-01T00:00:00.000Z）。 */
  date: string;
  name: string;
  type: string;
  source: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}
