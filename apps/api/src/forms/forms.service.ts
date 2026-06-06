import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FieldType,
  FormDefinition,
  FormField,
  FormSubmission,
  StepForm,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  EngineFormDefinition,
  EngineFormField,
  EngineFormSubmission,
  EngineStepForm,
  FieldReference,
  FormsEngineError,
  ResolvedReference,
  assertValidFormDefinition,
  planApprove,
  planReject,
  planSubmit,
  resolveReferences,
  toPrefillData,
  unmetRequiredForms,
} from './forms-engine';

/** 建立表單定義（含欄位）輸入。 */
export interface CreateFormInput {
  code: string;
  name: string;
  description?: string | null;
  isSignable?: boolean;
  fields: Array<{
    order: number;
    key: string;
    label: string;
    fieldType: FieldType;
    required?: boolean;
    options?: unknown;
  }>;
}

/** 送出表單填寫輸入。 */
export interface SubmitFormInput {
  formDefinitionId: string;
  caseId: string;
  stepInstanceId?: string | null;
  data: Record<string, unknown>;
  submittedById?: string | null;
}

function toEngineForm(
  form: FormDefinition & { fields: FormField[] },
): EngineFormDefinition {
  return {
    id: form.id,
    code: form.code,
    name: form.name,
    version: form.version,
    isSignable: form.isSignable,
    fields: form.fields.map(toEngineField),
  };
}

function toEngineField(f: FormField): EngineFormField {
  return {
    id: f.id,
    order: f.order,
    key: f.key,
    label: f.label,
    fieldType: f.fieldType,
    required: f.required,
    options: f.options ?? undefined,
  };
}

/**
 * 表單與產出文件服務（2.3）。
 *
 * 對應需求規格 §8.2：
 * - 自訂表單欄位並掛載步驟（createForm / attachFormToStep）。
 * - 送出與簽核（submitForm / approveSubmission / rejectSubmission），留存誰於何時送出／核可。
 * - 步驟必填表單把關（getStepCompletionGate），供 2.1 引擎於 advance 前檢查。
 * - 前段產出帶往後續引用（resolveStepReferences）。
 *
 * 設計決策：所有「決策／驗證」邏輯都委派給純核心 forms-engine（可純函式單元測試），
 * 本服務只負責讀寫資料庫並把引擎錯誤轉為對應 HTTP 例外（與 WorkflowService 一致）。
 */
@Injectable()
export class FormsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 將引擎錯誤轉為 400（含欄位錯誤）；其餘照原樣丟出。 */
  private run<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof FormsEngineError) {
        throw new BadRequestException(
          e.fieldErrors ? { code: e.code, fieldErrors: e.fieldErrors } : e.code,
        );
      }
      throw e;
    }
  }

  /** 建立可自訂的表單定義與欄位。 */
  async createForm(
    input: CreateFormInput,
  ): Promise<FormDefinition & { fields: FormField[] }> {
    const engineFields: EngineFormField[] = input.fields.map((f) => ({
      order: f.order,
      key: f.key,
      label: f.label,
      fieldType: f.fieldType,
      required: f.required ?? false,
      options: f.options,
    }));
    this.run(() => assertValidFormDefinition(engineFields));

    return this.prisma.formDefinition.create({
      data: {
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        isSignable: input.isSignable ?? false,
        fields: {
          create: input.fields.map((f) => ({
            order: f.order,
            key: f.key,
            label: f.label,
            fieldType: f.fieldType,
            required: f.required ?? false,
            options: (f.options ?? undefined) as never,
          })),
        },
      },
      include: { fields: { orderBy: { order: 'asc' } } },
    });
  }

  /** 將表單掛載到某流程步驟（可設定是否必填）。 */
  async attachFormToStep(
    stepId: string,
    formId: string,
    isRequired = true,
  ): Promise<StepForm> {
    return this.prisma.stepForm.upsert({
      where: { stepId_formId: { stepId, formId } },
      update: { isRequired },
      create: { stepId, formId, isRequired },
    });
  }

  /** 取得某步驟掛載的表單（含欄位），供 UI 帶出。 */
  async getStepForms(
    stepId: string,
  ): Promise<Array<{ isRequired: boolean; form: FormDefinition & { fields: FormField[] } }>> {
    const links = await this.prisma.stepForm.findMany({
      where: { stepId },
      include: { form: { include: { fields: { orderBy: { order: 'asc' } } } } },
    });
    return links.map((l) => ({ isRequired: l.isRequired, form: l.form }));
  }

  /** 送出一筆表單填寫（驗證欄位後存為 SUBMITTED，記錄送出人／時間）。 */
  async submitForm(input: SubmitFormInput): Promise<FormSubmission> {
    const form = await this.loadForm(input.formDefinitionId);
    const plan = this.run(() =>
      planSubmit(toEngineForm(form), input.data, input.submittedById ?? null),
    );

    return this.prisma.formSubmission.create({
      data: {
        formDefinitionId: form.id,
        caseId: input.caseId,
        stepInstanceId: input.stepInstanceId ?? null,
        status: plan.status,
        data: plan.data as never,
        submittedById: plan.submittedById,
        submittedAt: plan.submittedAt,
      },
    });
  }

  /** 核可一筆已送出的簽核類表單填寫（記錄核可人／時間）。 */
  async approveSubmission(submissionId: string, approverId: string | null): Promise<FormSubmission> {
    return this.finalizeSubmission(submissionId, approverId, 'approve');
  }

  /** 退回一筆已送出的簽核類表單填寫（記錄退回人／時間）。 */
  async rejectSubmission(submissionId: string, approverId: string | null): Promise<FormSubmission> {
    return this.finalizeSubmission(submissionId, approverId, 'reject');
  }

  private async finalizeSubmission(
    submissionId: string,
    approverId: string | null,
    action: 'approve' | 'reject',
  ): Promise<FormSubmission> {
    const submission = await this.prisma.formSubmission.findUnique({
      where: { id: submissionId },
    });
    if (!submission) throw new NotFoundException('submission_not_found');

    const form = await this.loadForm(submission.formDefinitionId);
    const engineSub: EngineFormSubmission = {
      id: submission.id,
      formDefinitionId: submission.formDefinitionId,
      stepInstanceId: submission.stepInstanceId,
      status: submission.status,
      data: submission.data as Record<string, unknown>,
      submittedById: submission.submittedById,
      approvedById: submission.approvedById,
    };

    const plan = this.run(() =>
      action === 'approve'
        ? planApprove(toEngineForm(form), engineSub, approverId)
        : planReject(toEngineForm(form), engineSub, approverId),
    );

    return this.prisma.formSubmission.update({
      where: { id: submission.id },
      data: {
        status: plan.status,
        approvedById: plan.approvedById,
        approvedAt: plan.approvedAt,
      },
    });
  }

  /** 列出某案件的所有表單填寫（含步驟順序，供追溯與引用）。 */
  async listCaseSubmissions(caseId: string): Promise<EngineFormSubmission[]> {
    const subs = await this.prisma.formSubmission.findMany({
      where: { caseId },
      include: { stepInstance: { select: { order: true } } },
    });
    return subs.map((s) => ({
      id: s.id,
      formDefinitionId: s.formDefinitionId,
      stepInstanceId: s.stepInstanceId,
      stepOrder: s.stepInstance?.order ?? null,
      status: s.status,
      data: s.data as Record<string, unknown>,
      submittedById: s.submittedById,
      approvedById: s.approvedById,
      createdAt: s.createdAt,
    }));
  }

  /**
   * 步驟完成把關：回傳該步驟尚未齊備的必填表單 id。
   * 供 2.1 引擎在 advance 前呼叫；空陣列代表可推進。
   */
  async getStepCompletionGate(
    caseId: string,
    stepId: string,
    stepInstanceId: string,
  ): Promise<{ ready: boolean; unmetFormIds: string[] }> {
    const [stepForms, submissions, signableFormIds] = await Promise.all([
      this.prisma.stepForm.findMany({ where: { stepId } }),
      this.listCaseSubmissions(caseId),
      this.signableFormIds(),
    ]);
    const engineStepForms: EngineStepForm[] = stepForms.map((sf: StepForm) => ({
      stepId: sf.stepId,
      formId: sf.formId,
      isRequired: sf.isRequired,
    }));
    const unmet = unmetRequiredForms(
      engineStepForms,
      submissions,
      stepId,
      stepInstanceId,
      signableFormIds,
    );
    return { ready: unmet.length === 0, unmetFormIds: unmet };
  }

  /**
   * 解析後續步驟可帶出的前段產出（報價單／客製需求文件 → 後續引用）。
   * 回傳每個 reference 的帶出值（含來源可追溯）與可直接套用的預填資料。
   */
  async resolveStepReferences(
    caseId: string,
    currentStepOrder: number,
    references: FieldReference[],
  ): Promise<{ resolved: ResolvedReference[]; prefill: Record<string, unknown> }> {
    const submissions = await this.listCaseSubmissions(caseId);
    const resolved = resolveReferences(references, submissions, currentStepOrder);
    return { resolved, prefill: toPrefillData(resolved) };
  }

  private async loadForm(
    formId: string,
  ): Promise<FormDefinition & { fields: FormField[] }> {
    const form = await this.prisma.formDefinition.findUnique({
      where: { id: formId },
      include: { fields: { orderBy: { order: 'asc' } } },
    });
    if (!form) throw new NotFoundException('form_not_found');
    return form;
  }

  private async signableFormIds(): Promise<Set<string>> {
    const signable = await this.prisma.formDefinition.findMany({
      where: { isSignable: true },
      select: { id: true },
    });
    return new Set(signable.map((f) => f.id));
  }
}
