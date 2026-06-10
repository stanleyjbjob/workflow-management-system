import { Injectable, NotFoundException } from '@nestjs/common';
import { FlowType, Prisma, RoleCode } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 流程定義 CRUD（issue 8.6 #41 / docs B1）。
 *
 * 持久化策略（關鍵決策，理由見 issue comment）：
 * - 設計器草稿（WorkflowDraft）含 DB 正規欄位之外的設計層資訊
 *   （trigger / calendar / 各步驟 forms+isoMapping）。為滿足「存→取→再存不失真」，
 *   以 `WorkflowDefinition.designer`（Json）保存「正規化後的完整草稿」作為唯一真實來源；
 *   同一交易內同步重建 StepDefinition 列（order/name/description/responsibleRoleId/isOptional），
 *   供案件引擎（createCaseFromWorkflow）直接使用，兩者必然一致。
 * - 草稿 forms 僅為「應填表單／應產出」之名稱參照（§12-3 表單實際欄位未定案），
 *   故不建立 FormDefinition / StepForm 實體；定案後再正規化。
 * - 無 designer Json 的既有資料（seed 或他處建立）→ 由 StepDefinition 列重建草稿（設計層欄位給預設值）。
 */

/** 與 apps/web workflow-designer/types.ts 對齊的草稿型別。 */
export interface StepFormRefDto {
  id: string;
  name: string;
  isRequired: boolean;
  isoMapping: string;
}

export interface StepDraftDto {
  id: string;
  order: number;
  name: string;
  description: string;
  responsibleRole: RoleCode | null;
  isOptional: boolean;
  forms: StepFormRefDto[];
}

export interface TriggerRuleDto {
  initiatorRole: RoleCode | null;
  condition: string;
}

export interface CalendarRuleDto {
  deferOnHoliday: boolean;
  deferStrategy: 'NEXT_WORKDAY' | 'SHIFT_ALL';
  note: string;
}

export interface WorkflowDraftDto {
  id: string;
  flowType: FlowType;
  name: string;
  description: string;
  version: number;
  isActive: boolean;
  trigger: TriggerRuleDto;
  calendar: CalendarRuleDto;
  steps: StepDraftDto[];
  updatedAt: string;
}

/** 列表摘要（對齊 web WorkflowSummary）。 */
export interface WorkflowSummaryDto {
  id: string;
  name: string;
  flowType: FlowType;
  version: number;
  isActive: boolean;
  stepCount: number;
  updatedAt: string;
}

/** 刪除結果：referenced=true 表示已有案件引用，改為停用（軟刪）。 */
export interface DeleteResultDto {
  id: string;
  deleted: boolean;
  deactivated: boolean;
  referencedByCases: number;
}

/** 業務驗證錯誤：snake_case code，由 controller 層 guardEngine 轉 400。 */
export class WorkflowDefinitionError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'WorkflowDefinitionError';
  }
}

const FLOW_TYPES = new Set<string>(Object.values(FlowType));
const ROLE_CODES = new Set<string>(Object.values(RoleCode));
const DEFER_STRATEGIES = new Set<string>(['NEXT_WORKDAY', 'SHIFT_ALL']);

const DEFAULT_TRIGGER: TriggerRuleDto = { initiatorRole: null, condition: '' };
const DEFAULT_CALENDAR: CalendarRuleDto = {
  deferOnHoliday: true,
  deferStrategy: 'NEXT_WORKDAY',
  note: '',
};

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

/** 正規化輸入草稿：驗證列舉、補預設值、步驟依 order 排序後重編 1..n（同 web reindex）。 */
function normalizeDraft(input: WorkflowDraftDto, id: string): WorkflowDraftDto {
  const name = asString(input.name).trim();
  if (name.length === 0) throw new WorkflowDefinitionError('invalid_name', '流程名稱不可為空');
  if (!FLOW_TYPES.has(asString(input.flowType))) {
    throw new WorkflowDefinitionError('invalid_flow_type', `未知流程型別：${String(input.flowType)}`);
  }
  const rawSteps = Array.isArray(input.steps) ? input.steps : [];
  const seenIds = new Set<string>();
  const steps = [...rawSteps]
    .sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0))
    .map((s, i) => {
      const stepName = asString(s?.name).trim();
      if (stepName.length === 0) {
        throw new WorkflowDefinitionError('invalid_step_name', `步驟 ${i + 1} 名稱不可為空`);
      }
      const role = s?.responsibleRole ?? null;
      if (role != null && !ROLE_CODES.has(role)) {
        throw new WorkflowDefinitionError('unknown_role', `未知角色代碼：${String(role)}`);
      }
      const stepId = asString(s?.id) || randomUUID();
      if (seenIds.has(stepId)) {
        throw new WorkflowDefinitionError('duplicate_step_id', `重複步驟 id：${stepId}`);
      }
      seenIds.add(stepId);
      const forms = (Array.isArray(s?.forms) ? s.forms : []).map((f) => ({
        id: asString(f?.id) || randomUUID(),
        name: asString(f?.name),
        isRequired: f?.isRequired !== false,
        isoMapping: asString(f?.isoMapping),
      }));
      return {
        id: stepId,
        order: i + 1,
        name: stepName,
        description: asString(s?.description),
        responsibleRole: (role as RoleCode | null) ?? null,
        isOptional: s?.isOptional === true,
        forms,
      };
    });

  const trigger: TriggerRuleDto = {
    initiatorRole:
      input.trigger?.initiatorRole != null && ROLE_CODES.has(input.trigger.initiatorRole)
        ? input.trigger.initiatorRole
        : null,
    condition: asString(input.trigger?.condition),
  };
  const calendar: CalendarRuleDto = {
    deferOnHoliday: input.calendar?.deferOnHoliday !== false,
    deferStrategy: DEFER_STRATEGIES.has(asString(input.calendar?.deferStrategy))
      ? (input.calendar!.deferStrategy as CalendarRuleDto['deferStrategy'])
      : DEFAULT_CALENDAR.deferStrategy,
    note: asString(input.calendar?.note),
  };

  const version = Number.isInteger(input.version) && input.version >= 1 ? input.version : 1;

  return {
    id,
    flowType: input.flowType,
    name,
    description: asString(input.description),
    version,
    isActive: input.isActive !== false,
    trigger,
    calendar,
    steps,
    updatedAt: new Date().toISOString(),
  };
}

@Injectable()
export class WorkflowDefinitionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 角色 code → Role.id 對照（步驟負責角色寫入 StepDefinition 用）。 */
  private async roleIdMap(): Promise<Map<RoleCode, string>> {
    const roles = await this.prisma.role.findMany({ select: { id: true, code: true } });
    return new Map(roles.map((r) => [r.code, r.id]));
  }

  async list(): Promise<WorkflowSummaryDto[]> {
    const rows = await this.prisma.workflowDefinition.findMany({
      include: { steps: { select: { id: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((w) => ({
      id: w.id,
      name: w.name,
      flowType: w.flowType,
      version: w.version,
      isActive: w.isActive,
      stepCount: w.steps.length,
      updatedAt: w.updatedAt.toISOString(),
    }));
  }

  async get(id: string): Promise<WorkflowDraftDto> {
    const row = await this.prisma.workflowDefinition.findUnique({
      where: { id },
      include: {
        steps: { orderBy: { order: 'asc' }, include: { responsibleRole: { select: { code: true } } } },
      },
    });
    if (!row) throw new NotFoundException('workflow_not_found');
    return this.toDraft(row);
  }

  async create(input: WorkflowDraftDto, createdById?: string | null): Promise<WorkflowDraftDto> {
    const id = asString(input.id) || randomUUID();
    const draft = normalizeDraft(input, id);
    const roleIds = await this.roleIdMap();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.workflowDefinition.create({
          data: {
            id: draft.id,
            flowType: draft.flowType,
            name: draft.name,
            description: draft.description || null,
            version: draft.version,
            isActive: draft.isActive,
            createdById: createdById ?? null,
            designer: draft as unknown as Prisma.InputJsonValue,
          },
        });
        await this.createSteps(tx, draft, roleIds);
      });
    } catch (err) {
      throw mapPrismaError(err);
    }
    return draft;
  }

  async update(id: string, input: WorkflowDraftDto): Promise<WorkflowDraftDto> {
    const existing = await this.prisma.workflowDefinition.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('workflow_not_found');
    const draft = normalizeDraft(input, id);
    const roleIds = await this.roleIdMap();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.workflowDefinition.update({
          where: { id },
          data: {
            flowType: draft.flowType,
            name: draft.name,
            description: draft.description || null,
            version: draft.version,
            isActive: draft.isActive,
            designer: draft as unknown as Prisma.InputJsonValue,
          },
        });
        // 全量替換步驟：以草稿為唯一真實來源（updatedAt 由 @updatedAt 自動 touch）。
        await tx.stepDefinition.deleteMany({ where: { workflowId: id } });
        await this.createSteps(tx, draft, roleIds);
      });
    } catch (err) {
      throw mapPrismaError(err);
    }
    return draft;
  }

  /**
   * 刪除：已有案件引用（Case.workflowId RESTRICT）→ 保護資料，改停用（isActive=false）；
   * 無引用 → 實刪（StepDefinition 隨 onDelete: Cascade 一併刪除）。
   */
  async remove(id: string): Promise<DeleteResultDto> {
    const existing = await this.prisma.workflowDefinition.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('workflow_not_found');
    const referenced = await this.prisma.case.count({ where: { workflowId: id } });
    if (referenced > 0) {
      await this.prisma.workflowDefinition.update({ where: { id }, data: { isActive: false } });
      return { id, deleted: false, deactivated: true, referencedByCases: referenced };
    }
    await this.prisma.workflowDefinition.delete({ where: { id } });
    return { id, deleted: true, deactivated: false, referencedByCases: 0 };
  }

  private async createSteps(
    tx: Pick<Prisma.TransactionClient, 'stepDefinition'>,
    draft: WorkflowDraftDto,
    roleIds: Map<RoleCode, string>,
  ): Promise<void> {
    for (const s of draft.steps) {
      const roleId = s.responsibleRole ? roleIds.get(s.responsibleRole) : null;
      if (s.responsibleRole && !roleId) {
        throw new WorkflowDefinitionError('unknown_role', `角色未建檔：${s.responsibleRole}`);
      }
      // 逐筆 create（非 createMany）以利 FakePrisma 與未來 nextStepId 鏈維護。
      await tx.stepDefinition.create({
        data: {
          id: s.id,
          workflowId: draft.id,
          order: s.order,
          name: s.name,
          description: s.description || null,
          responsibleRoleId: roleId ?? null,
          isOptional: s.isOptional,
        },
      });
    }
  }

  /** designer Json 優先；缺漏（seed／他處建立）時由正規列重建。欄位以 DB 欄為準覆寫。 */
  private toDraft(row: {
    id: string;
    flowType: FlowType;
    name: string;
    description: string | null;
    version: number;
    isActive: boolean;
    updatedAt: Date;
    designer?: unknown;
    steps: Array<{
      id: string;
      order: number;
      name: string;
      description: string | null;
      isOptional: boolean;
      responsibleRole: { code: RoleCode } | null;
    }>;
  }): WorkflowDraftDto {
    const designer = (row.designer ?? null) as WorkflowDraftDto | null;
    const stepsFromRows: StepDraftDto[] = row.steps.map((s) => {
      const fromDesigner = designer?.steps?.find((d) => d.id === s.id);
      return {
        id: s.id,
        order: s.order,
        name: s.name,
        description: s.description ?? '',
        responsibleRole: s.responsibleRole?.code ?? null,
        isOptional: s.isOptional,
        forms: fromDesigner?.forms ?? [],
      };
    });
    return {
      id: row.id,
      flowType: row.flowType,
      name: row.name,
      description: row.description ?? '',
      version: row.version,
      isActive: row.isActive,
      trigger: designer?.trigger ?? { ...DEFAULT_TRIGGER },
      calendar: designer?.calendar ?? { ...DEFAULT_CALENDAR },
      steps: stepsFromRows,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/** Prisma 唯一鍵衝突（@@unique([flowType,name,version])）→ 業務錯誤碼。 */
function mapPrismaError(err: unknown): unknown {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 'P2002') {
    return new WorkflowDefinitionError(
      'duplicate_workflow_version',
      '同流程型別＋名稱＋版本已存在',
    );
  }
  return err;
}
