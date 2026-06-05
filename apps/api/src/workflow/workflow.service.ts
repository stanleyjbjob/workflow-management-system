import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CaseStatus,
  FlowType,
  SaleMode,
  StepDefinition,
  StepInstance,
  StepInstanceStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdvancePlan,
  EngineStepDefinition,
  EngineStepInstance,
  ReturnPlan,
  WorkflowEngineError,
  planAdvance,
  planInitialInstances,
  planReturn,
  validateDefinition,
} from './workflow-engine';

/** 建立案件的輸入。 */
export interface CreateCaseInput {
  workflowId: string;
  title: string;
  clientName?: string | null;
  saleMode?: SaleMode | null;
  createdById?: string | null;
  /** 第一步驟的承辦人（選填；未提供則待指派）。 */
  assigneeId?: string | null;
  /** 自訂案件編號；未提供則自動產生。 */
  code?: string;
}

/** 推進選項。 */
export interface AdvanceOptions {
  /** 完成目前步驟的備註。 */
  note?: string | null;
  /** 下一步驟的承辦人；未提供則保留原值（待指派）。 */
  assigneeId?: string | null;
}

/** 退回選項。 */
export interface ReturnOptions {
  /** 退回原因（§8.4 要求留存）。 */
  reason: string;
  /** 重啟之目標步驟的承辦人；未提供則保留原值。 */
  assigneeId?: string | null;
}

/** 對外回傳的案件狀態摘要。 */
export interface CaseStateView {
  caseId: string;
  code: string;
  status: CaseStatus;
  currentStepInstanceId: string | null;
  currentStepDefinitionId: string | null;
  steps: Array<{
    stepInstanceId: string;
    stepDefinitionId: string;
    name: string;
    order: number;
    status: StepInstanceStatus;
    responsibleRoleId: string | null;
    assigneeId: string | null;
  }>;
}

function toEngineStep(s: StepDefinition): EngineStepDefinition {
  return {
    id: s.id,
    order: s.order,
    name: s.name,
    responsibleRoleId: s.responsibleRoleId ?? null,
    isOptional: s.isOptional,
  };
}

function toEngineInstance(i: StepInstance): EngineStepInstance {
  return {
    id: i.id,
    stepDefinitionId: i.stepDefinitionId,
    order: i.order,
    status: i.status,
  };
}

function generateCaseCode(flowType: FlowType): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate(),
  ).padStart(2, '0')}`;
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${flowType}-${ymd}-${rand}`;
}

/**
 * 流程引擎服務：以純核心（workflow-engine）計算轉換計畫，並落實到資料庫。
 *
 * 提供：
 * - createCaseFromWorkflow：依流程定義建立案件並物化各步驟實例（第一步直接開工）。
 * - advanceCase：完成目前步驟、推進到下一步並帶出負責角色；無下一步則案件完成。
 * - returnCase：退回到較早步驟（支援循環，如複測不過退回開發），並留存退回原因。
 * - getCaseState：取得案件目前狀態與所有步驟摘要。
 *
 * 設計決策：步驟「負責角色」由流程定義（StepDefinition.responsibleRoleId）決定並隨轉換帶出；
 * 但「自動指派到哪一位使用者」涉及業務規則（需求 §12 待釐清第 1 項：跨角色移交是否需主管核可），
 * 故本階段僅在呼叫端明確提供 assigneeId 時才指派承辦人，否則保留待人工指派。
 */
@Injectable()
export class WorkflowService {
  constructor(private readonly prisma: PrismaService) {}

  /** 將引擎錯誤轉為 400；其餘照原樣丟出。 */
  private run<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof WorkflowEngineError) {
        throw new BadRequestException(e.code);
      }
      throw e;
    }
  }

  async createCaseFromWorkflow(input: CreateCaseInput): Promise<CaseStateView> {
    const workflow = await this.prisma.workflowDefinition.findUnique({
      where: { id: input.workflowId },
      include: { steps: true },
    });
    if (!workflow) throw new NotFoundException('workflow_not_found');

    const engineSteps = workflow.steps.map(toEngineStep);
    const errors = validateDefinition(engineSteps);
    if (errors.length > 0) throw new BadRequestException(errors[0]);

    const blueprint = this.run(() => planInitialInstances(engineSteps));
    const code = input.code ?? generateCaseCode(workflow.flowType);

    const caseId = await this.prisma.$transaction(async (tx) => {
      const created = await tx.case.create({
        data: {
          code,
          workflowId: workflow.id,
          flowType: workflow.flowType,
          title: input.title,
          clientName: input.clientName ?? null,
          saleMode: input.saleMode ?? null,
          status: CaseStatus.IN_PROGRESS,
          assigneeId: input.assigneeId ?? null,
          createdById: input.createdById ?? null,
        },
      });

      for (const b of blueprint) {
        const isFirst = b.status === StepInstanceStatus.IN_PROGRESS;
        const instance = await tx.stepInstance.create({
          data: {
            caseId: created.id,
            stepDefinitionId: b.stepDefinitionId,
            order: b.order,
            status: b.status,
            assigneeId: isFirst ? input.assigneeId ?? null : null,
            startedAt: isFirst ? new Date() : null,
          },
        });
        if (isFirst) {
          await tx.case.update({
            where: { id: created.id },
            data: { currentStepInstanceId: instance.id },
          });
        }
      }
      return created.id;
    });

    return this.getCaseState(caseId);
  }

  async advanceCase(caseId: string, opts: AdvanceOptions = {}): Promise<CaseStateView> {
    const { caseRow, steps, instances } = await this.loadCase(caseId);
    if (!caseRow.currentStepInstanceId) {
      throw new BadRequestException('no_current_step');
    }

    const plan: AdvancePlan = this.run(() =>
      planAdvance(steps, instances, caseRow.currentStepInstanceId as string),
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.stepInstance.update({
        where: { id: plan.completedInstanceId },
        data: {
          status: StepInstanceStatus.COMPLETED,
          completedAt: new Date(),
          ...(opts.note != null ? { note: opts.note } : {}),
        },
      });

      if (plan.caseCompleted) {
        await tx.case.update({
          where: { id: caseId },
          data: { status: CaseStatus.COMPLETED, currentStepInstanceId: null },
        });
        return;
      }

      await tx.stepInstance.update({
        where: { id: plan.nextInstanceId as string },
        data: {
          status: StepInstanceStatus.IN_PROGRESS,
          startedAt: new Date(),
          ...(opts.assigneeId !== undefined ? { assigneeId: opts.assigneeId } : {}),
        },
      });
      await tx.case.update({
        where: { id: caseId },
        data: { status: CaseStatus.IN_PROGRESS, currentStepInstanceId: plan.nextInstanceId },
      });
    });

    return this.getCaseState(caseId);
  }

  async returnCase(
    caseId: string,
    targetStepDefinitionId: string,
    opts: ReturnOptions,
  ): Promise<CaseStateView> {
    const { caseRow, steps, instances } = await this.loadCase(caseId);
    if (!caseRow.currentStepInstanceId) {
      throw new BadRequestException('no_current_step');
    }

    const plan: ReturnPlan = this.run(() =>
      planReturn(steps, instances, caseRow.currentStepInstanceId as string, targetStepDefinitionId),
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.stepInstance.update({
        where: { id: plan.returnedInstanceId },
        data: { status: StepInstanceStatus.RETURNED, note: opts.reason, completedAt: new Date() },
      });
      await tx.stepInstance.update({
        where: { id: plan.targetInstanceId },
        data: {
          status: StepInstanceStatus.IN_PROGRESS,
          startedAt: new Date(),
          completedAt: null,
          ...(opts.assigneeId !== undefined ? { assigneeId: opts.assigneeId } : {}),
        },
      });
      await tx.case.update({
        where: { id: caseId },
        data: { status: CaseStatus.IN_PROGRESS, currentStepInstanceId: plan.targetInstanceId },
      });
    });

    return this.getCaseState(caseId);
  }

  async getCaseState(caseId: string): Promise<CaseStateView> {
    const { caseRow, steps, instances } = await this.loadCase(caseId);
    const defById = new Map(steps.map((s) => [s.id, s]));
    const instById = new Map(caseRow.stepInstances.map((i) => [i.id, i]));

    const view = instances
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((i) => {
        const def = defById.get(i.stepDefinitionId);
        const full = instById.get(i.id) as StepInstance;
        return {
          stepInstanceId: i.id,
          stepDefinitionId: i.stepDefinitionId,
          name: def?.name ?? '',
          order: i.order,
          status: i.status,
          responsibleRoleId: def?.responsibleRoleId ?? null,
          assigneeId: full?.assigneeId ?? null,
        };
      });

    const currentStepDefinitionId = caseRow.currentStepInstanceId
      ? instById.get(caseRow.currentStepInstanceId)?.stepDefinitionId ?? null
      : null;

    return {
      caseId: caseRow.id,
      code: caseRow.code,
      status: caseRow.status,
      currentStepInstanceId: caseRow.currentStepInstanceId ?? null,
      currentStepDefinitionId,
      steps: view,
    };
  }

  private async loadCase(caseId: string): Promise<{
    caseRow: CaseWithRelations;
    steps: EngineStepDefinition[];
    instances: EngineStepInstance[];
  }> {
    const caseRow = (await this.prisma.case.findUnique({
      where: { id: caseId },
      include: { workflow: { include: { steps: true } }, stepInstances: true },
    })) as CaseWithRelations | null;
    if (!caseRow) throw new NotFoundException('case_not_found');

    const steps = caseRow.workflow.steps.map(toEngineStep);
    const instances = caseRow.stepInstances.map(toEngineInstance);
    return { caseRow, steps, instances };
  }
}

/** loadCase 回傳的關聯型別（避免引入 Prisma 產生的複雜泛型）。 */
interface CaseWithRelations {
  id: string;
  code: string;
  status: CaseStatus;
  currentStepInstanceId: string | null;
  workflow: { steps: StepDefinition[] };
  stepInstances: StepInstance[];
}
