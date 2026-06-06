import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService } from '../calendar/calendar.service';
import { HolidayCalendarInput, businessDaysBetween } from '../calendar/calendar-engine';
import { ProjectService } from './project.service';
import {
  DayBasis,
  DelayEvaluation,
  DelaySummary,
  FlowTypeThresholdConfig,
  WorkdayCounter,
  evaluateFlows,
  summarizeDelays,
} from './delay-engine';

/**
 * 延遲／超前計算服務（NestJS）。對應 issue 5.3 / 規格 §4.2–§4.4、§5.1（狀態清單）。
 *
 * 將 delay-engine 純邏輯套在既有 Project / ProjectFlow 資料上：
 * - getProjectDelays：讀專案各掛載流程，計算五種狀態 + 差異百分比 + 差異天數，附彙總。
 * - getProjectDelaysFresh：先依案件步驟比例回寫各流程 progress（ProjectService.refreshFlowProgress）
 *   再計算，使延遲判斷反映最新完成度（§6.2）。
 *
 * 差異天數基準（§9-3 待釐清）：預設 CALENDAR（日曆日）；basis='WORKDAY' 時改以行事曆工作日計，
 * 透過 CalendarService.buildCalendar + calendar-engine.businessDaysBetween 注入 workdayCounter
 * （扣除假日／週末），與 5.2 甘特圖 / 4.1 行事曆一致。容許門檻可依流程型別覆寫（§9-2）。
 *
 * 不在此處理（屬後續 issue）：排除日順延 planEnd（5.4 #26）、REST controller / 前端狀態清單繪製。
 */
@Injectable()
export class DelayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectService,
    private readonly calendar: CalendarService,
  ) {}

  /** 以行事曆工作日數作為計畫工期（供 WORKDAY 基準）。 */
  private buildWorkdayCounter(custom?: HolidayCalendarInput): WorkdayCounter {
    const cal = this.calendar.buildCalendar(custom ?? {});
    return (from: Date, to: Date) => businessDaysBetween(from, to, cal);
  }

  /** 讀取專案並計算各流程延遲／超前 + 彙總。 */
  async getProjectDelays(
    projectId: string,
    options: GetProjectDelaysOptions = {},
  ): Promise<ProjectDelayReport> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { flows: { orderBy: { planStart: 'asc' } } },
    });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    const basis: DayBasis = options.basis ?? 'CALENDAR';
    const workdayCounter = basis === 'WORKDAY' ? this.buildWorkdayCounter(options.custom) : undefined;

    const rows = evaluateFlows(
      project.flows.map((f) => ({
        id: f.id,
        caseId: f.caseId,
        flowType: f.flowType,
        name: f.name,
        planStart: f.planStart,
        planEnd: f.planEnd,
        progress: f.progress,
      })),
      { now: options.now, thresholds: options.thresholds, basis, workdayCounter },
    );

    return { projectId, basis, rows, summary: summarizeDelays(rows) };
  }

  /** 先回寫各流程進度（依案件步驟完成比例）再計算延遲／超前。 */
  async getProjectDelaysFresh(
    projectId: string,
    options: GetProjectDelaysOptions = {},
  ): Promise<ProjectDelayReport> {
    const flows = await this.prisma.projectFlow.findMany({
      where: { projectId },
      select: { id: true, caseId: true },
    });
    for (const f of flows) {
      if (f.caseId) {
        await this.projects.refreshFlowProgress(f.id);
      }
    }
    return this.getProjectDelays(projectId, options);
  }
}

/** 取得專案延遲／超前報表之選項。 */
export interface GetProjectDelaysOptions {
  /** 評估基準時間，預設 now。 */
  now?: Date;
  /** 容許門檻：數字＝統一 T；物件＝可依流程型別覆寫。 */
  thresholds?: FlowTypeThresholdConfig | number;
  /** 差異天數基準，預設 CALENDAR。 */
  basis?: DayBasis;
  /** WORKDAY 基準時用以建構行事曆（公司自訂假日／補班／週末）。 */
  custom?: HolidayCalendarInput;
}

/** 專案延遲／超前報表。 */
export interface ProjectDelayReport {
  projectId: string;
  basis: DayBasis;
  rows: DelayEvaluation[];
  summary: DelaySummary;
}
