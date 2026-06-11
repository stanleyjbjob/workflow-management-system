import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Attachment,
  AttachmentType,
  CaseStatus,
  FlowType,
  FormSubmission,
  SaleMode,
  StepInstanceStatus,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SessionUser } from '../auth/auth.service';
import { AccessScopeService } from '../rbac/access-scope.service';
import {
  AdvanceOptions,
  CaseStateView,
  ReturnOptions,
  WorkflowService,
} from '../workflow/workflow.service';

/** GET /cases 的查詢過濾（皆選填；值為原始字串，由本服務驗證）。 */
export interface CaseListFilter {
  flowType?: string;
  status?: string;
  assigneeId?: string;
}

/** 使用者摘要（嵌入回應用）。 */
export interface UserRefDto {
  id: string;
  displayName: string;
}

/** 案件清單列。 */
export interface CaseSummaryDto {
  id: string;
  code: string;
  title: string;
  flowType: FlowType;
  status: CaseStatus;
  clientName: string | null;
  saleMode: SaleMode | null;
  assignee: UserRefDto | null;
  currentStep: {
    stepInstanceId: string;
    name: string;
    order: number;
    assigneeId: string | null;
    dueDate: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

/** 步驟表單彙整狀態：尚無填寫紀錄為 MISSING，否則取最佳 submission 狀態。 */
export type StepFormAggregateStatus = SubmissionStatus | 'MISSING';

/** 案件詳情：單一步驟應填表單的狀態。 */
export interface CaseStepFormDto {
  formId: string;
  code: string;
  name: string;
  isRequired: boolean;
  isSignable: boolean;
  status: StepFormAggregateStatus;
  /** 達成判定與 forms-engine.unmetRequiredForms 同義：必填且（可簽核需 APPROVED；否則 SUBMITTED/APPROVED）。非必填恆 true。 */
  satisfied: boolean;
  submissionId: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
}

/** 案件詳情：步驟列（順序/名稱/負責角色/負責人/到期日/狀態 + 表單狀態）。 */
export interface CaseStepDto {
  stepInstanceId: string;
  stepDefinitionId: string;
  order: number;
  name: string;
  description: string | null;
  responsibleRoleId: string | null;
  responsibleRoleName: string | null;
  assignee: UserRefDto | null;
  status: StepInstanceStatus;
  dueDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  note: string | null;
  forms: CaseStepFormDto[];
}

/** 案件詳情：附件列（案件層 + 步驟層 + 表單層一併彙整）。 */
export interface CaseAttachmentDto {
  id: string;
  type: AttachmentType;
  name: string;
  fileUrl: string | null;
  linkUrl: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  version: number;
  stepInstanceId: string | null;
  formSubmissionId: string | null;
  createdAt: string;
}

/** GET /cases/:id/detail 的彙整視圖（對齊前端 case-detail/types.ts 之 CaseRecord 所需資料）。 */
export interface CaseDetailDto {
  id: string;
  code: string;
  title: string;
  flowType: FlowType;
  status: CaseStatus;
  clientName: string | null;
  saleMode: SaleMode | null;
  failureReason: string | null;
  workflow: { id: string; name: string; version: number };
  assignee: UserRefDto | null;
  createdBy: UserRefDto | null;
  currentStepInstanceId: string | null;
  steps: CaseStepDto[];
  attachments: CaseAttachmentDto[];
  createdAt: string;
  updatedAt: string;
}

const SUBMISSION_RANK: Record<SubmissionStatus, number> = {
  [SubmissionStatus.APPROVED]: 4,
  [SubmissionStatus.SUBMITTED]: 3,
  [SubmissionStatus.REJECTED]: 2,
  [SubmissionStatus.DRAFT]: 1,
};

function iso(d: Date | null | undefined): string | null {
  return d ? new Date(d).toISOString() : null;
}

function toUserRef(
  u: { id: string; displayName: string } | null | undefined,
): UserRefDto | null {
  return u ? { id: u.id, displayName: u.displayName } : null;
}

/**
 * 案件統一查詢/詳情/推進服務（issue 8.7 #42 / docs B2）。
 *
 * 設計重點：
 * - 清單：以 `AccessScopeService.caseWhere(user)` 收斂可見範圍（§8.5），
 *   其餘過濾條件（flowType / status / assigneeId）以 AND 疊加。
 * - 詳情：單次彙整「案件基本資料＋步驟（含負責角色/負責人/到期日/狀態）＋
 *   各步驟表單狀態＋附件」，對齊前端案件詳情頁一次取得所需欄位。
 * - 表單狀態彙整規則與 forms-engine.unmetRequiredForms 一致：
 *   同一步驟實例 × 同一表單可能有多筆 submission（退回重填），取「最佳」狀態
 *   （APPROVED > SUBMITTED > REJECTED > DRAFT；同階取最新建立）；無紀錄為 MISSING。
 * - 推進/退回：純粹包裝 WorkflowService 既有 advanceCase / returnCase
 *   （四大流程的專屬動作如成案/結案仍走各自 controller），但先以
 *   `assertCanViewCase` 確認可見性，避免越權操作不可見案件。
 */
@Injectable()
export class CasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessScope: AccessScopeService,
    private readonly workflow: WorkflowService,
  ) {}

  /** 案件清單（依角色可見範圍收斂；支援 flowType / status / assigneeId 過濾）。 */
  async list(user: SessionUser, filter: CaseListFilter = {}): Promise<CaseSummaryDto[]> {
    const conditions: Record<string, unknown>[] = [this.accessScope.caseWhere(user)];

    if (filter.flowType != null && filter.flowType !== '') {
      if (!(filter.flowType in FlowType)) {
        throw new BadRequestException('invalid_flow_type');
      }
      conditions.push({ flowType: filter.flowType as FlowType });
    }
    if (filter.status != null && filter.status !== '') {
      if (!(filter.status in CaseStatus)) {
        throw new BadRequestException('invalid_status');
      }
      conditions.push({ status: filter.status as CaseStatus });
    }
    if (filter.assigneeId != null && filter.assigneeId !== '') {
      conditions.push({ assigneeId: filter.assigneeId });
    }

    const rows = await this.prisma.case.findMany({
      where: { AND: conditions },
      include: {
        assignee: true,
        currentStep: { include: { stepDefinition: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return rows.map((c: any) => ({
      id: c.id,
      code: c.code,
      title: c.title,
      flowType: c.flowType,
      status: c.status,
      clientName: c.clientName ?? null,
      saleMode: c.saleMode ?? null,
      assignee: toUserRef(c.assignee),
      currentStep: c.currentStep
        ? {
            stepInstanceId: c.currentStep.id,
            name: c.currentStep.stepDefinition?.name ?? '',
            order: c.currentStep.order,
            assigneeId: c.currentStep.assigneeId ?? null,
            dueDate: iso(c.currentStep.dueDate),
          }
        : null,
      createdAt: iso(c.createdAt) as string,
      updatedAt: iso(c.updatedAt) as string,
    }));
  }

  /** 案件詳情彙整視圖。不可見（RBAC）→ 403；不存在 → 404。 */
  async detail(user: SessionUser, caseId: string): Promise<CaseDetailDto> {
    const row = (await this.prisma.case.findUnique({
      where: { id: caseId },
      include: {
        workflow: {
          include: {
            steps: {
              include: {
                responsibleRole: true,
                forms: { include: { form: true } },
              },
            },
          },
        },
        stepInstances: { include: { assignee: true } },
        submissions: true,
        assignee: true,
        createdBy: true,
      },
    })) as any;
    if (!row) throw new NotFoundException('case_not_found');

    this.accessScope.assertCanViewCase(user, row);

    // 附件不只掛在案件層：步驟層 / 表單層也可能未冗餘 caseId，故以 OR 一次撈齊。
    const attachments = (await this.prisma.attachment.findMany({
      where: {
        OR: [
          { caseId },
          { stepInstance: { caseId } },
          { formSubmission: { caseId } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    })) as Attachment[];

    const defById = new Map<string, any>(row.workflow.steps.map((s: any) => [s.id, s]));
    const submissions = row.submissions as FormSubmission[];

    const steps: CaseStepDto[] = (row.stepInstances as any[])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((inst) => {
        const def = defById.get(inst.stepDefinitionId);
        const stepForms: CaseStepFormDto[] = ((def?.forms ?? []) as any[]).map((sf) => {
          const best = this.bestSubmission(submissions, sf.formId, inst.id);
          const status: StepFormAggregateStatus = best ? best.status : 'MISSING';
          const ok = sf.form?.isSignable
            ? status === SubmissionStatus.APPROVED
            : status === SubmissionStatus.SUBMITTED || status === SubmissionStatus.APPROVED;
          return {
            formId: sf.formId,
            code: sf.form?.code ?? '',
            name: sf.form?.name ?? '',
            isRequired: !!sf.isRequired,
            isSignable: !!sf.form?.isSignable,
            status,
            satisfied: sf.isRequired ? ok : true,
            submissionId: best?.id ?? null,
            submittedAt: iso(best?.submittedAt),
            approvedAt: iso(best?.approvedAt),
          };
        });

        return {
          stepInstanceId: inst.id,
          stepDefinitionId: inst.stepDefinitionId,
          order: inst.order,
          name: def?.name ?? '',
          description: def?.description ?? null,
          responsibleRoleId: def?.responsibleRoleId ?? null,
          responsibleRoleName: def?.responsibleRole?.name ?? null,
          assignee: toUserRef(inst.assignee),
          status: inst.status,
          dueDate: iso(inst.dueDate),
          startedAt: iso(inst.startedAt),
          completedAt: iso(inst.completedAt),
          note: inst.note ?? null,
          forms: stepForms,
        };
      });

    return {
      id: row.id,
      code: row.code,
      title: row.title,
      flowType: row.flowType,
      status: row.status,
      clientName: row.clientName ?? null,
      saleMode: row.saleMode ?? null,
      failureReason: row.failureReason ?? null,
      workflow: {
        id: row.workflow.id,
        name: row.workflow.name,
        version: row.workflow.version,
      },
      assignee: toUserRef(row.assignee),
      createdBy: toUserRef(row.createdBy),
      currentStepInstanceId: row.currentStepInstanceId ?? null,
      steps,
      attachments: attachments.map((a) => ({
        id: a.id,
        type: a.type,
        name: a.name,
        fileUrl: a.fileUrl ?? null,
        linkUrl: a.linkUrl ?? null,
        mimeType: a.mimeType ?? null,
        sizeBytes: a.sizeBytes ?? null,
        version: a.version,
        stepInstanceId: a.stepInstanceId ?? null,
        formSubmissionId: a.formSubmissionId ?? null,
        createdAt: iso(a.createdAt) as string,
      })),
      createdAt: iso(row.createdAt) as string,
      updatedAt: iso(row.updatedAt) as string,
    };
  }

  /** 通用推進（包 WorkflowService.advanceCase；先檢查可見性）。 */
  async advance(
    user: SessionUser,
    caseId: string,
    opts: AdvanceOptions = {},
  ): Promise<CaseStateView> {
    await this.assertVisible(user, caseId);
    return this.workflow.advanceCase(caseId, opts);
  }

  /** 通用退回（包 WorkflowService.returnCase；先檢查可見性與必要參數）。 */
  async return(
    user: SessionUser,
    caseId: string,
    targetStepDefinitionId: string | undefined,
    opts: Partial<ReturnOptions> = {},
  ): Promise<CaseStateView> {
    if (!targetStepDefinitionId) {
      throw new BadRequestException('target_step_required');
    }
    if (!opts.reason || opts.reason.trim() === '') {
      throw new BadRequestException('return_reason_required');
    }
    await this.assertVisible(user, caseId);
    return this.workflow.returnCase(caseId, targetStepDefinitionId, {
      reason: opts.reason,
      assigneeId: opts.assigneeId,
    });
  }

  /** 載入可見性判定所需最小欄位並斷言；不存在 → 404。 */
  private async assertVisible(user: SessionUser, caseId: string): Promise<void> {
    const row = (await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { id: true, flowType: true, assigneeId: true, createdById: true },
    })) as { flowType: FlowType; assigneeId: string | null; createdById: string | null } | null;
    if (!row) throw new NotFoundException('case_not_found');
    this.accessScope.assertCanViewCase(user, row);
  }

  /** 同步驟實例 × 同表單的多筆 submission 取最佳（狀態階級高者優先，同階取最新建立）。 */
  private bestSubmission(
    submissions: readonly FormSubmission[],
    formDefinitionId: string,
    stepInstanceId: string,
  ): FormSubmission | null {
    let best: FormSubmission | null = null;
    for (const s of submissions) {
      if (s.formDefinitionId !== formDefinitionId) continue;
      if (s.stepInstanceId !== stepInstanceId) continue;
      if (
        !best ||
        SUBMISSION_RANK[s.status] > SUBMISSION_RANK[best.status] ||
        (SUBMISSION_RANK[s.status] === SUBMISSION_RANK[best.status] &&
          new Date(s.createdAt).getTime() > new Date(best.createdAt).getTime())
      ) {
        best = s;
      }
    }
    return best;
  }
}
