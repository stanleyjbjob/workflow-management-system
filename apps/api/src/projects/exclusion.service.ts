import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ExclusionSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService } from '../calendar/calendar.service';
import { CheckpointOffset, DeferralMode } from '../calendar/calendar-engine';
import {
  ExclusionDraftInput,
  ExclusionEngineError,
  NormalizedExclusion,
  buildExclusionDraft,
  buildExclusionPatch,
} from './exclusion-engine';

/**
 * 專案行事曆排除日服務（NestJS）。對應 issue 5.4（#26）/ 規格 §3.3、§6.3、§10.5。
 *
 * 將 exclusion-engine 的純驗證落實到既有 Exclusion 資料表（不新增 migration，沿用 5.1/5.2 風格），
 * 並串接 4.1 CalendarService 達成「時程計算避開排除日 + 國定假日（併行）」（規格 §7、§8.3）。
 *
 * 範圍（issue 5.4「預期行為」）：
 * - addExclusion / listExclusions / updateExclusion / removeExclusion：新增 / 移除 / 編輯排除日（起、迄、原因、來源）。
 * - deferDateAvoidingExclusions / rescheduleWithExclusions：時程避開排除日（委派 CalendarService，讀同一張表）。
 * 甘特圖網底標示已於 5.2 gantt-engine（GanttExclusionBand）與 GanttService 完成，讀同一張 Exclusion 表，
 * 故新增 / 移除排除日後甘特圖即時反映，無需於本服務重複。
 *
 * ⚠️ 業務規則待釐清（規格 §9-5 / §9-6，刻意不臆測，待人類 review）：
 * - 排除日是否區分「全專案」與「特定流程」：資料模型 Exclusion 目前僅有 projectId（全專案）。
 * - 排除日落在流程區間內時是否自動順延 ProjectFlow.planEnd（順延工作日數）或僅標示：規格以「建議」表述、
 *   尚未定案。rescheduleWithExclusions 僅回傳重算結果，不自動寫回任何 planEnd，待確認後再串接。
 */
@Injectable()
export class ExclusionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: CalendarService,
  ) {}

  /** 將排除日引擎錯誤轉為 400（保留 code 供前端判讀）。 */
  private guard<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof ExclusionEngineError) {
        throw new BadRequestException({ code: e.code, message: e.message });
      }
      throw e as Error;
    }
  }

  private async assertProject(projectId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);
  }

  /**
   * 新增排除日（起、迄、原因、來源）。日期正規化為 UTC 午夜，與行事曆 / 甘特日界一致；
   * 驗證由 exclusion-engine 把關（from<=to、reason 必填、source 限 CUSTOMER/INTERNAL）。
   * 新增後即自動參與時程遞延（CalendarService 讀同一張表）並呈現於甘特圖網底（GanttService 讀同一張表）。
   */
  async addExclusion(projectId: string, input: ExclusionDraftInput): Promise<{ id: string }> {
    await this.assertProject(projectId);
    const draft: NormalizedExclusion = this.guard(() => buildExclusionDraft(input));
    return this.prisma.exclusion.create({
      data: {
        projectId,
        fromDate: draft.fromDate,
        toDate: draft.toDate,
        reason: draft.reason,
        source: (draft.source ?? undefined) as ExclusionSource | undefined,
      },
      select: { id: true },
    });
  }

  /** 列出某專案的排除日（依起始日排序）。 */
  async listExclusions(projectId: string): Promise<unknown[]> {
    await this.assertProject(projectId);
    return this.prisma.exclusion.findMany({
      where: { projectId },
      orderBy: { fromDate: 'asc' },
    });
  }

  /** 編輯排除日（部分更新；未提供欄位沿用現值，仍重新驗證 from<=to）。 */
  async updateExclusion(exclusionId: string, input: ExclusionDraftInput): Promise<{ id: string }> {
    const current = await this.prisma.exclusion.findUnique({
      where: { id: exclusionId },
      select: { fromDate: true, toDate: true, reason: true, source: true },
    });
    if (!current) throw new NotFoundException(`Exclusion ${exclusionId} not found`);
    const patched: NormalizedExclusion = this.guard(() =>
      buildExclusionPatch(input, {
        fromDate: current.fromDate,
        toDate: current.toDate,
        reason: current.reason,
        source: (current.source ?? null) as NormalizedExclusion['source'],
      }),
    );
    return this.prisma.exclusion.update({
      where: { id: exclusionId },
      data: {
        fromDate: patched.fromDate,
        toDate: patched.toDate,
        reason: patched.reason,
        source: (patched.source ?? null) as ExclusionSource | null,
      },
      select: { id: true },
    });
  }

  /** 移除排除日。 */
  async removeExclusion(exclusionId: string): Promise<{ id: string }> {
    const exists = await this.prisma.exclusion.findUnique({ where: { id: exclusionId }, select: { id: true } });
    if (!exists) throw new NotFoundException(`Exclusion ${exclusionId} not found`);
    await this.prisma.exclusion.delete({ where: { id: exclusionId } });
    return { id: exclusionId };
  }

  /**
   * 將指定日期遞延至「避開該專案排除日 + 國定假日 / 週末」之最近工作日
   * （§6.3 步驟3「時程計算避開該區間」、§7「排除日與國定假日併行」）。
   * 委派 CalendarService（同一張 Exclusion 表 + 行事曆引擎）。預設遞延至「最近且不早於當日」之工作日；
   * 單一時間點的避讓不涉及 §9-6 之 planEnd 自動順延規則。
   */
  async deferDateAvoidingExclusions(projectId: string, date: Date | string): Promise<Date> {
    await this.assertProject(projectId);
    const d = date instanceof Date ? date : new Date(date);
    return this.calendar.deferToWorkday(d, { projectId });
  }

  /**
   * 依錨點 + 時間點位移，套用「行事曆 + 該專案排除日」重算時程（§8.3）。
   * mode 預設 NEXT_WORKDAY；§9-6（落入流程區間是否自動順延 planEnd）尚未定案，故僅回傳重算結果，
   * 不自動寫回任何 ProjectFlow.planEnd，待人類確認順延規則後再串接。
   */
  async rescheduleWithExclusions(
    projectId: string,
    anchor: Date | string,
    checkpoints: readonly CheckpointOffset[],
    mode: DeferralMode = DeferralMode.NEXT_WORKDAY,
  ): Promise<unknown> {
    await this.assertProject(projectId);
    const a = anchor instanceof Date ? anchor : new Date(anchor);
    return this.calendar.reschedule(a, checkpoints, { projectId, mode });
  }
}
