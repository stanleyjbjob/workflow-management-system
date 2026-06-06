import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectService } from './project.service';
import {
  BuildGanttParams,
  DEFAULT_TOLERANCE_THRESHOLD,
  GanttFlowInput,
  GanttView,
  buildGantt,
} from './gantt-engine';

/**
 * 甘特圖服務（NestJS）。對應 issue 5.2 / 規格 §5.2、§5.1（KPI）、§10.3。
 *
 * 將 gantt-engine 的純呈現邏輯套在既有 Project / ProjectFlow / Exclusion 資料上：
 * - getProjectGantt：讀取專案 → 組裝 GanttView（軸/月份刻度/長條/今日線/排除日網底/KPI）。
 * - getProjectGanttFresh：可選先依案件步驟比例回寫各流程 progress（呼叫 ProjectService.refreshFlowProgress）
 *   再產生甘特圖，使呈現反映最新步驟完成度（規格 §6.2「進度隨案件推進自動更新」）。
 *
 * 不在此處理（屬後續 issue）：
 * - 排除日順延重算（5.4 #26）：本服務之排除日僅作甘特圖網底標示與 KPI 區間計數，不改動 planEnd。
 * - 延遲/超前的天數換算與容許門檻設定來源（5.3 #25、§9-2/§9-7）：引擎已輸出 delta 與狀態，
 *   容許門檻先用引擎預設（DEFAULT_TOLERANCE_THRESHOLD），可由呼叫端覆寫。
 * - REST controller / 前端繪製屬後續 API / UI 層任務。
 */
@Injectable()
export class GanttService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectService,
  ) {}

  /** 讀取專案並組裝甘特圖呈現資料。 */
  async getProjectGantt(
    projectId: string,
    options?: { now?: Date; toleranceThreshold?: number },
  ): Promise<GanttView> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        flows: { orderBy: { planStart: 'asc' } },
        exclusions: { orderBy: { fromDate: 'asc' } },
      },
    });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    const flows: GanttFlowInput[] = project.flows.map((f) => ({
      id: f.id,
      caseId: f.caseId,
      flowType: f.flowType,
      name: f.name,
      planStart: f.planStart,
      planEnd: f.planEnd,
      progress: f.progress,
    }));

    const params: BuildGanttParams = {
      project: { planStart: project.planStart, planEnd: project.planEnd },
      flows,
      exclusions: project.exclusions.map((x) => ({
        fromDate: x.fromDate,
        toDate: x.toDate,
        reason: x.reason,
        source: x.source,
      })),
      now: options?.now,
      toleranceThreshold: options?.toleranceThreshold ?? DEFAULT_TOLERANCE_THRESHOLD,
    };
    return buildGantt(params);
  }

  /**
   * 先回寫各流程進度（依案件步驟完成比例）再產生甘特圖。
   * 無對應案件的流程其 progress 不更動（保留人工填報值，見 ProjectService.refreshFlowProgress）。
   */
  async getProjectGanttFresh(
    projectId: string,
    options?: { now?: Date; toleranceThreshold?: number },
  ): Promise<GanttView> {
    const flows = await this.prisma.projectFlow.findMany({
      where: { projectId },
      select: { id: true, caseId: true },
    });
    if (flows.length === 0) {
      // 仍驗證專案存在性，交由 getProjectGantt 拋 NotFound。
      return this.getProjectGantt(projectId, options);
    }
    for (const f of flows) {
      if (f.caseId) {
        await this.projects.refreshFlowProgress(f.id);
      }
    }
    return this.getProjectGantt(projectId, options);
  }
}
