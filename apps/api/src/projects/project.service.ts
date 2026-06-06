import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FlowType, ProjectStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  FlowMountInput,
  ProjectDraftInput,
  ProjectEngineError,
  assertStatusTransition,
  averageProgress,
  buildFlowMount,
  buildProjectDraft,
  buildProjectPatch,
  computeStepCompletionProgress,
  generateProjectCode,
} from './project-engine';

/**
 * 專案管理服務（NestJS）。將 project-engine 的純決策落實到 Prisma。
 *
 * 對應 issue 5.1 / 規格 §3、§5.1、§6.1，落實範圍（依現有 schema：Project / ProjectFlow / Exclusion，
 * 不新增 migration）：
 * - createProject / getProject / listProjects / updateProject / deleteProject：專案 CRUD（規格 §8-1）。
 * - mountFlow：將既有案件（流程實例）掛載至專案並設定計畫起迄；允許先後與重疊（規格 §3.2、§6.1）。
 * - updateFlowWindow / unmountFlow：調整／移除掛載。
 * - refreshFlowProgress：依案件步驟完成比例回寫 ProjectFlow.progress（規格 §4.1 預設認定）。
 * - getProjectDetail：向下查看每個流程的步驟與負責人（驗收：「可掛載流程並向下查看其步驟與負責人」）。
 *
 * 注意（待後續 / 人類 review）：
 * - 甘特圖（5.2）、延遲／超前判斷（5.3）、排除日順延重算（5.4）、簡報模式（5.5）、雙向導覽 UI（5.6）屬後續 issue。
 * - 進度認定方式（§9-1：步驟比例／加權工時／人工填報）本輪先以「步驟完成比例」為預設，保留 progress 可人工覆寫。
 * - REST controller / 前端 UI 屬後續 API 層任務。
 * - 權限（規格 §2）由 RBAC 層於 controller 套用；本服務不在此重複實作可見範圍。
 */
@Injectable()
export class ProjectService {
  constructor(private readonly prisma: PrismaService) {}

  /** 將引擎錯誤轉為 400（保留 code 供前端判讀）。 */
  private rethrow(e: unknown): never {
    if (e instanceof ProjectEngineError) {
      throw new BadRequestException({ code: e.code, message: e.message });
    }
    throw e as Error;
  }

  /** 執行引擎純函式，將其 ProjectEngineError 轉為 400。 */
  private guard<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      this.rethrow(e);
    }
  }

  /** 產生未碰撞的專案代碼（PRJ-YYYYMM-#### ，序號＝該月件數，碰撞遞增重試）。 */
  private async nextProjectCode(now: Date): Promise<string> {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const monthStart = new Date(Date.UTC(y, m, 1));
    const monthEnd = new Date(Date.UTC(y, m + 1, 1));
    const baseCount: number = await this.prisma.project.count({
      where: { createdAt: { gte: monthStart, lt: monthEnd } },
    });
    for (let i = 1; i <= 50; i++) {
      const code = generateProjectCode({ now, sequence: baseCount + i });
      const exists = await this.prisma.project.findUnique({ where: { code }, select: { id: true } });
      if (!exists) return code;
    }
    // 極端碰撞退路：以時間戳尾碼確保唯一
    return generateProjectCode({ now, sequence: baseCount + 1 }) + '-' + Date.now().toString(36);
  }

  /** 建立專案（規格 §6.1 步驟1）。 */
  async createProject(params: ProjectDraftInput & { createdById?: string | null }): Promise<{ id: string; code: string }> {
    const draft = this.guard(() => buildProjectDraft(params));
    const now = new Date();
    const code = await this.nextProjectCode(now);
    const created = await this.prisma.project.create({
      data: {
        code,
        name: draft.name,
        client: draft.client,
        ownerId: draft.ownerId,
        planStart: draft.planStart,
        planEnd: draft.planEnd,
        status: ProjectStatus.ACTIVE,
        createdById: params.createdById ?? null,
      },
      select: { id: true, code: true },
    });
    return created;
  }

  /** 讀取單一專案（含掛載流程與排除日）。 */
  async getProject(id: string): Promise<unknown> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        flows: { orderBy: { planStart: 'asc' } },
        exclusions: { orderBy: { fromDate: 'asc' } },
        owner: { select: { id: true, displayName: true, email: true } },
      },
    });
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    return project;
  }

  /** 列出專案（可選 status / ownerId 過濾）。 */
  async listProjects(filter?: { status?: ProjectStatus; ownerId?: string }): Promise<unknown[]> {
    return this.prisma.project.findMany({
      where: {
        ...(filter?.status ? { status: filter.status } : {}),
        ...(filter?.ownerId ? { ownerId: filter.ownerId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { flows: { select: { id: true, progress: true } } },
    });
  }

  /** 編輯專案（名稱／客戶／負責人／計畫起迄）。 */
  async updateProject(id: string, patchInput: ProjectDraftInput): Promise<{ id: string }> {
    const current = await this.prisma.project.findUnique({
      where: { id },
      select: { planStart: true, planEnd: true },
    });
    if (!current) throw new NotFoundException(`Project ${id} not found`);
    const patch = this.guard(() =>
      buildProjectPatch(patchInput, { planStart: current.planStart, planEnd: current.planEnd }),
    );
    const updated = await this.prisma.project.update({
      where: { id },
      data: patch,
      select: { id: true },
    });
    return updated;
  }

  /** 變更專案狀態（依狀態機把關）。 */
  async changeStatus(id: string, to: ProjectStatus): Promise<{ id: string; status: ProjectStatus }> {
    const current = await this.prisma.project.findUnique({ where: { id }, select: { status: true } });
    if (!current) throw new NotFoundException(`Project ${id} not found`);
    this.guard(() => assertStatusTransition(current.status as ProjectStatus, to));
    const updated = await this.prisma.project.update({
      where: { id },
      data: { status: to },
      select: { id: true, status: true },
    });
    return updated as { id: string; status: ProjectStatus };
  }

  /** 刪除專案（schema onDelete: Cascade 連帶刪除 flows / exclusions）。 */
  async deleteProject(id: string): Promise<{ id: string }> {
    const exists = await this.prisma.project.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException(`Project ${id} not found`);
    await this.prisma.project.delete({ where: { id } });
    return { id };
  }

  /**
   * 將案件（流程實例）掛載至專案並設定計畫起迄（規格 §3.2、§6.1）。
   * 若提供 caseId，驗證案件存在並可由案件帶出 flowType / 顯示名稱；允許各流程先後與重疊（不做重疊阻擋）。
   */
  async mountFlow(projectId: string, input: FlowMountInput): Promise<{ id: string }> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    let caseFallback: { flowType: FlowType; name: string } | undefined;
    const caseId = (input.caseId ?? '').trim() || null;
    if (caseId) {
      const c = await this.prisma.case.findUnique({
        where: { id: caseId },
        select: { id: true, flowType: true, title: true },
      });
      if (!c) throw new NotFoundException(`Case ${caseId} not found`);
      // 案件已明指 flowType 時，不允許掛載為不一致的 flowType
      if (input.flowType && input.flowType !== c.flowType) {
        throw new BadRequestException({
          code: 'flow_type_mismatch',
          message: `指定 flowType ${input.flowType} 與案件 ${caseId} 的 ${c.flowType} 不一致`,
        });
      }
      caseFallback = { flowType: c.flowType as FlowType, name: c.title };
    }

    const mount = this.guard(() => buildFlowMount(input, caseFallback));
    const created = await this.prisma.projectFlow.create({
      data: {
        projectId,
        caseId: mount.caseId,
        flowType: mount.flowType,
        name: mount.name,
        planStart: mount.planStart,
        planEnd: mount.planEnd,
        progress: mount.progress,
      },
      select: { id: true },
    });
    return created;
  }

  /** 調整掛載流程的計畫起迄 / 進度。 */
  async updateFlowWindow(
    projectFlowId: string,
    input: { planStart?: Date | string; planEnd?: Date | string; progress?: number },
  ): Promise<{ id: string }> {
    const flow = await this.prisma.projectFlow.findUnique({
      where: { id: projectFlowId },
      select: { id: true, flowType: true, name: true, planStart: true, planEnd: true, progress: true },
    });
    if (!flow) throw new NotFoundException(`ProjectFlow ${projectFlowId} not found`);
    // 重用 buildFlowMount 的視窗 / 進度驗證；沿用既有 flowType / name。
    const mount = this.guard(() =>
      buildFlowMount({
        flowType: flow.flowType as FlowType,
        name: flow.name,
        planStart: input.planStart ?? flow.planStart,
        planEnd: input.planEnd ?? flow.planEnd,
        progress: input.progress ?? flow.progress,
      }),
    );
    const updated = await this.prisma.projectFlow.update({
      where: { id: projectFlowId },
      data: { planStart: mount.planStart, planEnd: mount.planEnd, progress: mount.progress },
      select: { id: true },
    });
    return updated;
  }

  /** 移除流程掛載（不刪除案件本身）。 */
  async unmountFlow(projectFlowId: string): Promise<{ id: string }> {
    const flow = await this.prisma.projectFlow.findUnique({ where: { id: projectFlowId }, select: { id: true } });
    if (!flow) throw new NotFoundException(`ProjectFlow ${projectFlowId} not found`);
    await this.prisma.projectFlow.delete({ where: { id: projectFlowId } });
    return { id: projectFlowId };
  }

  /**
   * 依掛載案件的步驟完成比例回寫 ProjectFlow.progress（規格 §4.1 預設認定）。
   * 無對應案件的流程不更動其 progress（保留人工填報值）。
   */
  async refreshFlowProgress(projectFlowId: string): Promise<{ id: string; progress: number }> {
    const flow = await this.prisma.projectFlow.findUnique({
      where: { id: projectFlowId },
      select: { id: true, caseId: true, progress: true },
    });
    if (!flow) throw new NotFoundException(`ProjectFlow ${projectFlowId} not found`);
    if (!flow.caseId) return { id: flow.id, progress: flow.progress };

    const steps: { status: string }[] = await this.prisma.stepInstance.findMany({
      where: { caseId: flow.caseId },
      select: { status: true },
    });
    const progress = computeStepCompletionProgress(steps);
    const updated = await this.prisma.projectFlow.update({
      where: { id: projectFlowId },
      data: { progress },
      select: { id: true, progress: true },
    });
    return updated as { id: string; progress: number };
  }

  /**
   * 專案詳情：每個流程向下展開其案件步驟與負責人（驗收要點）。
   * 回傳：專案摘要 + overallProgress（各流程平均）+ 各流程（含 case 步驟清單：order / 步驟名稱 / 負責角色 / 負責人）。
   */
  async getProjectDetail(id: string): Promise<unknown> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, displayName: true } },
        flows: { orderBy: { planStart: 'asc' } },
        exclusions: { orderBy: { fromDate: 'asc' } },
      },
    });
    if (!project) throw new NotFoundException(`Project ${id} not found`);

    const flows: Array<{ id: string; caseId: string | null; flowType: FlowType; name: string; planStart: Date; planEnd: Date; progress: number }>
      = project.flows;

    const flowDetails = await Promise.all(
      flows.map(async (f) => {
        let caseDetail: unknown = null;
        if (f.caseId) {
          const c = await this.prisma.case.findUnique({
            where: { id: f.caseId },
            select: {
              id: true,
              code: true,
              status: true,
              currentStepInstanceId: true,
              assignee: { select: { id: true, displayName: true } },
            },
          });
          const steps: Array<{
            id: string;
            order: number;
            status: string;
            dueDate: Date | null;
            assignee: { id: string; displayName: string } | null;
            stepDefinition: { name: string; responsibleRole: { code: string; name: string } | null } | null;
          }> = await this.prisma.stepInstance.findMany({
            where: { caseId: f.caseId },
            orderBy: { order: 'asc' },
            select: {
              id: true,
              order: true,
              status: true,
              dueDate: true,
              assignee: { select: { id: true, displayName: true } },
              stepDefinition: {
                select: {
                  name: true,
                  responsibleRole: { select: { code: true, name: true } },
                },
              },
            },
          });
          caseDetail = c ? { ...c, steps } : null;
        }
        return { ...f, case: caseDetail };
      }),
    );

    return {
      id: project.id,
      code: project.code,
      name: project.name,
      client: project.client,
      owner: project.owner,
      planStart: project.planStart,
      planEnd: project.planEnd,
      status: project.status,
      overallProgress: averageProgress(flows),
      exclusions: project.exclusions,
      flows: flowDetails,
    };
  }
}
