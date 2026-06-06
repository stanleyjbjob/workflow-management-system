import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CheckpointOffset,
  DeferralMode,
  HolidayCalendar,
  HolidayCalendarInput,
  RescheduledCheckpoint,
  SAMPLE_TW_FIXED_HOLIDAYS_2026,
  buildCalendar,
  buildExcludedPredicate,
  deferToWorkday,
  nextWorkday,
  reschedule,
  toIsoDate,
} from './calendar-engine';

/**
 * 行事曆服務（NestJS）。將 calendar-engine 的純曆法決策落實到資料來源。
 *
 * 對應需求規格 §8.3「行事曆整合：自動判斷國定假日 / 連假、自動遞延並重算時程」，
 * 並整合 §10.5 專案層級行事曆排除日（Exclusion 資料表）。
 *
 * 假日來源（§8.3「政府行事曆 / 公司自訂」、§12-5 待釐清）目前以「呼叫端提供之
 * HolidayCalendarInput + 內建範例固定日」組成；尚未新增 Holiday 資料表（避免本輪 migration，
 * 沿用既有「不新增 migration」風格）。待人類確認假日來源後，可改由 DB / 政府行事曆匯入。
 *
 * 專案排除日：讀取既有 Exclusion 資料表（projectId、fromDate~toDate 區間），轉為遞延 predicate。
 */
@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 建構行事曆：合併「內建範例固定假日」與呼叫端提供之自訂假日 / 補班 / 週末設定。
   * 注意：範例僅含西曆固定日，農曆連假 / 補班需由 custom（公司自訂 / 政府行事曆）帶入。
   */
  buildCalendar(custom: HolidayCalendarInput = {}): HolidayCalendar {
    return buildCalendar({
      holidays: [...SAMPLE_TW_FIXED_HOLIDAYS_2026, ...(custom.holidays ?? [])],
      makeupWorkdays: custom.makeupWorkdays,
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
   * 非工作日（週末 / 假日）或落在專案排除日 → 排除。
   */
  async buildIsExcluded(opts: {
    projectId?: string;
    custom?: HolidayCalendarInput;
  } = {}): Promise<(date: Date) => boolean> {
    const cal = this.buildCalendar(opts.custom);
    const projectExcluded = await this.getProjectExclusionPredicate(opts.projectId);
    return buildExcludedPredicate(cal, projectExcluded);
  }

  /** 將日期遞延至最近（含當日）之工作日，考慮假日 / 週末 / 專案排除日。 */
  async deferToWorkday(date: Date, opts: { projectId?: string; custom?: HolidayCalendarInput } = {}): Promise<Date> {
    const cal = this.buildCalendar(opts.custom);
    const projectExcluded = await this.getProjectExclusionPredicate(opts.projectId);
    return deferToWorkday(date, cal, projectExcluded);
  }

  /** 取嚴格下一個工作日。 */
  async nextWorkday(date: Date, opts: { projectId?: string; custom?: HolidayCalendarInput } = {}): Promise<Date> {
    const cal = this.buildCalendar(opts.custom);
    const projectExcluded = await this.getProjectExclusionPredicate(opts.projectId);
    return nextWorkday(date, cal, projectExcluded);
  }

  /**
   * 依錨點 + 時間點位移重算時程（套用假日遞延 + 專案排除日）。
   * mode 預設 NEXT_WORKDAY（順延下一工作日）；可選 PUSH_FORWARD（整體後推）。
   */
  async reschedule(
    anchor: Date,
    checkpoints: readonly CheckpointOffset[],
    opts: { projectId?: string; custom?: HolidayCalendarInput; mode?: DeferralMode } = {},
  ): Promise<RescheduledCheckpoint[]> {
    const cal = this.buildCalendar(opts.custom);
    const projectExcluded = await this.getProjectExclusionPredicate(opts.projectId);
    return reschedule(anchor, checkpoints, cal, opts.mode ?? DeferralMode.NEXT_WORKDAY, projectExcluded);
  }
}
