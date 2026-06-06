import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { HolidaySource, HolidayType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CheckpointOffset,
  DeferralMode,
  HolidayCalendar,
  HolidayCalendarInput,
  IsoDate,
  RescheduledCheckpoint,
  SAMPLE_TW_FIXED_HOLIDAYS_2026,
  buildCalendar,
  buildExcludedPredicate,
  deferToWorkday,
  nextWorkday,
  parseIsoDate,
  reschedule,
  toIsoDate,
} from './calendar-engine';

/**
 * Holiday 資料列（DB 投影）→ calendar-engine 行事曆輸入。純函式（無 DB / Nest 相依），供單元測試。
 * type === 'MAKEUP_WORKDAY' 視為補班日；其餘（HOLIDAY）視為放假日。日界一律 UTC（toIsoDate）。
 */
export function holidayRowsToCalendarInput(
  rows: readonly { date: Date; type: string }[],
): { holidays: IsoDate[]; makeupWorkdays: IsoDate[] } {
  const holidays: IsoDate[] = [];
  const makeupWorkdays: IsoDate[] = [];
  for (const r of rows) {
    const iso = toIsoDate(r.date);
    if (r.type === 'MAKEUP_WORKDAY') makeupWorkdays.push(iso);
    else holidays.push(iso);
  }
  return { holidays, makeupWorkdays };
}

/** 新增 / 更新假日之輸入。date 可為 yyyy-mm-dd 字串或 Date。 */
export interface HolidayRecordInput {
  date: string | Date;
  name: string;
  type?: HolidayType;
  source?: HolidaySource;
  note?: string | null;
}

/**
 * 行事曆服務（NestJS）。將 calendar-engine 的純曆法決策落實到資料來源。
 *
 * 對應需求規格 §8.3「行事曆整合：自動判斷國定假日 / 連假、自動遞延並重算時程」，
 * 並整合 §10.5 專案層級行事曆排除日（Exclusion 資料表）。
 *
 * 假日來源（§8.3「政府行事曆 / 公司自訂」、§12-5）：自 7.1 起改由 `Holiday` 資料表持久化、
 * 由主管維護（國定假日 / 連假 / 補班）。`loadCalendar()` 讀 DB 合併「內建範例固定日 + 呼叫端自訂」。
 * 同步 `buildCalendar()` 保留供無 DB / 純兜底情境；需 DB 假日驅動者一律使用 async 方法。
 *
 * 專案排除日：讀取既有 Exclusion 資料表（projectId、fromDate~toDate 區間），轉為遞延 predicate。
 */
@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 同步建構行事曆：合併「內建範例固定假日」與呼叫端提供之自訂假日 / 補班 / 週末設定。
   * 不讀 DB；供無資料庫 / 純兜底情境。需 DB 假日請改用 loadCalendar()。
   */
  buildCalendar(custom: HolidayCalendarInput = {}): HolidayCalendar {
    return buildCalendar({
      holidays: [...SAMPLE_TW_FIXED_HOLIDAYS_2026, ...(custom.holidays ?? [])],
      makeupWorkdays: custom.makeupWorkdays,
      weekendDays: custom.weekendDays,
    });
  }

  /**
   * 讀 `Holiday` 資料表並與「內建範例固定日 + 呼叫端自訂」合併為行事曆（§8.3、§12-5）。
   * Holiday 表由主管維護；calendar-engine 對「同日同時為假日 / 補班」之衝突以假日優先。
   */
  async loadCalendar(custom: HolidayCalendarInput = {}): Promise<HolidayCalendar> {
    const rows = await this.prisma.holiday.findMany({ select: { date: true, type: true } });
    const fromDb = holidayRowsToCalendarInput(rows);
    return buildCalendar({
      holidays: [...SAMPLE_TW_FIXED_HOLIDAYS_2026, ...fromDb.holidays, ...(custom.holidays ?? [])],
      makeupWorkdays: [...fromDb.makeupWorkdays, ...(custom.makeupWorkdays ?? [])],
      weekendDays: custom.weekendDays,
    });
  }

  /**
   * 載入某專案之排除日，回傳「該日是否落在任一排除區間（含端點）」的 predicate。
   * 無 projectId 時回傳恆 false 之 predicate。
   */
  async getProjectExclusionPredicate(projectId?: string): Promise<(date: Date) => boolean> {
    if (!projectId) return () => false;
    const exclusions = await this.prisma.exclusion.findMany({
      where: { projectId },
      select: { fromDate: true, toDate: true },
    });
    const ranges = exclusions.map((e) => ({
      from: toIsoDate(e.fromDate),
      to: toIsoDate(e.toDate),
    }));
    return (date: Date) => {
      const key = toIsoDate(date);
      return ranges.some((r) => key >= r.from && key <= r.to);
    };
  }

  /**
   * 組出可注入排程器（如 onboarding `buildSchedule`）的 `isExcluded(date) => boolean`：
   * 非工作日（週末 / 假日）或落在專案排除日 → 排除。假日來源由 DB `Holiday` 表驅動。
   */
  async buildIsExcluded(opts: {
    projectId?: string;
    custom?: HolidayCalendarInput;
  } = {}): Promise<(date: Date) => boolean> {
    const cal = await this.loadCalendar(opts.custom);
    const projectExcluded = await this.getProjectExclusionPredicate(opts.projectId);
    return buildExcludedPredicate(cal, projectExcluded);
  }

  /** 將日期遞延至最近（含當日）之工作日，考慮 DB 假日 / 週末 / 補班 / 專案排除日。 */
  async deferToWorkday(date: Date, opts: { projectId?: string; custom?: HolidayCalendarInput } = {}): Promise<Date> {
    const cal = await this.loadCalendar(opts.custom);
    const projectExcluded = await this.getProjectExclusionPredicate(opts.projectId);
    return deferToWorkday(date, cal, projectExcluded);
  }

  /** 取嚴格下一個工作日（假日來源由 DB 驅動）。 */
  async nextWorkday(date: Date, opts: { projectId?: string; custom?: HolidayCalendarInput } = {}): Promise<Date> {
    const cal = await this.loadCalendar(opts.custom);
    const projectExcluded = await this.getProjectExclusionPredicate(opts.projectId);
    return nextWorkday(date, cal, projectExcluded);
  }

  /**
   * 依錨點 + 時間點位移重算時程（套用 DB 假日遞延 + 專案排除日）。
   * mode 預設 NEXT_WORKDAY（順延下一工作日）；可選 PUSH_FORWARD（整體後推）。
   */
  async reschedule(
    anchor: Date,
    checkpoints: readonly CheckpointOffset[],
    opts: { projectId?: string; custom?: HolidayCalendarInput; mode?: DeferralMode } = {},
  ): Promise<RescheduledCheckpoint[]> {
    const cal = await this.loadCalendar(opts.custom);
    const projectExcluded = await this.getProjectExclusionPredicate(opts.projectId);
    return reschedule(anchor, checkpoints, cal, opts.mode ?? DeferralMode.NEXT_WORKDAY, projectExcluded);
  }

  /* ───────────────── Holiday CRUD（主管維護，§12-5） ───────────────── */

  /** 列出假日 / 補班（可依日期區間與類型過濾），依日期升冪。 */
  async listHolidays(
    opts: { from?: string | Date; to?: string | Date; type?: HolidayType } = {},
  ) {
    const where: Prisma.HolidayWhereInput = {};
    if (opts.from || opts.to) {
      where.date = {
        ...(opts.from ? { gte: this.normalizeDate(opts.from) } : {}),
        ...(opts.to ? { lte: this.normalizeDate(opts.to) } : {}),
      };
    }
    if (opts.type) where.type = opts.type;
    return this.prisma.holiday.findMany({ where, orderBy: { date: 'asc' } });
  }

  /** 新增一筆假日 / 補班。日期重複（@@unique([date]）→ BadRequest('holiday_date_duplicate')。 */
  async addHoliday(input: HolidayRecordInput) {
    const date = this.normalizeDate(input.date);
    const name = (input.name ?? '').trim();
    if (!name) throw new BadRequestException('holiday_name_required');
    try {
      return await this.prisma.holiday.create({
        data: {
          date,
          name,
          type: input.type ?? HolidayType.HOLIDAY,
          source: input.source ?? HolidaySource.GOVERNMENT,
          note: input.note ?? null,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('holiday_date_duplicate');
      }
      throw e;
    }
  }

  /** 更新一筆假日 / 補班（部分更新）。 */
  async updateHoliday(id: string, patch: Partial<HolidayRecordInput>) {
    const data: Prisma.HolidayUpdateInput = {};
    if (patch.date !== undefined) data.date = this.normalizeDate(patch.date);
    if (patch.name !== undefined) {
      const n = patch.name.trim();
      if (!n) throw new BadRequestException('holiday_name_required');
      data.name = n;
    }
    if (patch.type !== undefined) data.type = patch.type;
    if (patch.source !== undefined) data.source = patch.source;
    if (patch.note !== undefined) data.note = patch.note;
    try {
      return await this.prisma.holiday.update({ where: { id }, data });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') throw new BadRequestException('holiday_date_duplicate');
        if (e.code === 'P2025') throw new NotFoundException(`Holiday ${id} not found`);
      }
      throw e;
    }
  }

  /** 刪除一筆假日 / 補班。 */
  async removeHoliday(id: string): Promise<{ id: string }> {
    try {
      await this.prisma.holiday.delete({ where: { id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new NotFoundException(`Holiday ${id} not found`);
      }
      throw e;
    }
    return { id };
  }

  /** 將輸入正規化為 UTC 午夜 Date（接受 yyyy-mm-dd 或 Date）；非法日期 → BadRequest。 */
  private normalizeDate(d: string | Date): Date {
    try {
      return d instanceof Date ? parseIsoDate(toIsoDate(d)) : parseIsoDate(d);
    } catch {
      throw new BadRequestException('holiday_date_invalid');
    }
  }
}
