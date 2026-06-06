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
import { FlowExclusionConflict, detectExclusionConflicts } from './exclusion-conflict';

/**
 * 專案行事曆排除日服務（NestJS）。對應 issue 5.4（#26）/ 規格 §3.3、§6.3、§10.5、§9-5/§9-6。
 *
 * 將 exclusion-engine 的純驗證落實到既有 Exclusion 資料表（不新增 migration，沿用 5.1/5.2 風格），
 * 並串接 4.1 CalendarService 達成「時程計算避開排除日 + 國定假日（併行）」（規格 §7、§8.3）。
 *
 * 範圍（issue 5.4「預期行為」）：
 * - addExclusion / listExclusions / updateExclusion / removeExclusion：新增 / 移除 / 編輯排除日（起、迄、原因、來源）。
 * - deferDateAvoidingExclusions / rescheduleWithExclusions：時程避開排除日（委派 CalendarService，讀同一張表）。
 * - getExclusionConflicts：偵測排除日與流程計畫區間之重疊並回報警示（見下方業務裁示）。
 * 甘特圖網底標示已於 5.2 gantt-engine（GanttExclusionBand）與 GanttService 完成，讀同一張 Exclusion 表，
 * 故新增 / 移除排除日後甘特圖即時反映，無需於本服務重複。
 *
 * 業務裁示（2026-06-06，專案負責人，原 §9-5 / §9-6 待釐清已定案）：
 * - §9-6 採 **A 案**：排除日**不自動順延** ProjectFlow.planEnd。改由 getExclusionConflicts 回報「排除日落入
 *   流程計畫區間」之衝突警示（哪條流程、撞到哪些排除日、重疊區間與天數），UI 顯示提醒、**由使用者自行決定是否延期**。
 *   rescheduleWithExclusions 仍保留為「使用者選擇延期後」可用的重算工具，但本服務不主動寫回任何 planEnd。
 * - §9-5：排除日維持**全專案**層級（Exclusion 僅 projectId，不分流程），故衝突偵測對專案內每條流程逐一比對。
 * - source 維持 CUSTOMER / INTERNAL 兩值。
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
   * 偵測排除日與流程計畫區間之衝突（§9-6 A 案）。回報每條「有排除日落入其計畫區間」的流程及重疊明細，
   * 供 UI 顯示警示，由使用者自行決定是否延期（本方法不改動任何 planEnd）。
   * 預設只回傳有衝突的流程；includeAllFlows=true 時回傳全部流程（conflicts 可能為空）。
   */
  async getExclusionConflicts(
    projectId: string,
    options: { includeAllFlows?: boolean } = {},
  ): Promise<FlowExclusionConflict[]> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        flows: { orderBy: { planStart: 'asc' } },
        exclusions: { orderBy: { fromDate: 'asc' } },
      },
    });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);
    return detectExclusionConflicts(
      project.flows.map((f) => ({
        flowId: f.id,
        name: f.name,
        flowType: f.flowType,
        planStart: f.planStart,
        planEnd: f.planEnd,
      })),
      project.exclusions.map((x) => ({
        exclusionId: x.id,
        fromDate: x.fromDate,
        toDate: x.toDate,
        reason: x.reason,
        source: x.source,
      })),
      { includeFlowsWithoutConflict: options.includeAllFlows },
    );
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
   * mode 預設 NEXT_WORKDAY。依負責人裁示（§9-6 A 案），本服務**不主動**將結果寫回 ProjectFlow.planEnd；
   * 此方法作為「使用者於 getExclusionConflicts 警示後選擇延期」時的重算工具，由呼叫端決定是否採用。
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
