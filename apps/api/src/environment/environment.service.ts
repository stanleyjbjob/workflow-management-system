import { Injectable, NotFoundException } from '@nestjs/common';
import { CaseStatus, FlowType, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import {
  ENV_HOST_PROCUREMENT_FORM_CODE,
  ENVIRONMENT_INTAKE_FORM_CODE,
  EnvironmentAcceptanceResult,
  EnvironmentIntake,
  FormStatusLike,
  HostReadiness,
  deserializeEnvironmentIntake,
  evaluateHostReadiness,
  intakeFromOnboardingHandoff,
  planAcceptance,
  serializeEnvironmentIntake,
} from './environment-engine';

/**
 * 環境建置流程服務（NestJS）。將 environment-engine 的純決策落實到 Prisma。
 *
 * 對應需求規格 §6「環境建置流程（工程師）」，落實範圍（依現有 schema）：
 * - receiveFromOnboarding：自導入案件取回移交藍圖（onboarding.getEngineeringHandoff），
 *   轉為環境建置接收並 append-only 落地於 ENVIRONMENT 案件。對應 §6.2 步驟1、§3。
 * - recordHostProcurement / getHostReadiness：買斷制「等待客戶採購主機」狀態記錄與就緒判斷，
 *   未採購時把案件標為 ON_HOLD（等待），採購後回到 IN_PROGRESS。對應 §6.3。
 * - submitEnvironmentForm / getFormStatuses：分支建置產出（建置檢核表 / 租戶開立紀錄）與
 *   環境驗收表填寫（append-only）。對應 §6.2 步驟2/3。
 * - completeEnvironment：驗收把關（買斷需主機已採購＋分支表單齊備＋驗收表完成）後，
 *   將案件標記為 COMPLETED（環境就緒）。對應 §6.2 步驟3、§6.3。
 *
 * 設計沿用 sales / onboarding 模組：表單與接收藍圖均以既有 FormSubmission 持久化
 * （append-only，不刪改），以固定 code 的 FormDefinition 作為容器（resolve-or-create），
 * 本輪不新增 migration。
 *
 * 注意（待後續 / 人類 review）：
 * - ENVIRONMENT 流程定義（WorkflowDefinition）由 6.x / 流程設計器產生；建立案件時需呼叫端提供
 *   既有 envWorkflowId。本服務通常承接 onboarding.handoffToEngineering 已建立的 ENVIRONMENT 案件。
 * - 驗收完成是否需顧問簽核（§6.2 由工程師／顧問）屬 §12-4 待釐清，目前以表單齊備認定。
 */
@Injectable()
export class EnvironmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly onboarding: OnboardingService,
  ) {}

  /** 解析（或首次建立）某 code 的專用表單定義容器。 */
  private async resolveForm(
    code: string,
    name: string,
    description: string,
    isSignable = false,
  ): Promise<{ id: string }> {
    const existing = await this.prisma.formDefinition.findFirst({
      where: { code },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (existing) return existing;
    return this.prisma.formDefinition.create({
      data: { code, name, description, isSignable },
      select: { id: true },
    });
  }

  /**
   * 接收導入移交（§6.2 步驟1）。讀取導入案件之移交藍圖（onboarding.getEngineeringHandoff），
   * 轉為環境建置接收（intakeFromOnboardingHandoff），並 append-only 落地於 ENVIRONMENT 案件，
   * 使「導入產出自動帶往環境建置」durable（§3 / §8.2）。尚無移交藍圖時回傳 null。
   */
  async receiveFromOnboarding(params: {
    environmentCaseId: string;
    onboardingCaseId: string;
    receivedById?: string | null;
  }): Promise<EnvironmentIntake | null> {
    const envCase = await this.prisma.case.findUnique({
      where: { id: params.environmentCaseId },
      select: { id: true, flowType: true },
    });
    if (!envCase) throw new NotFoundException(`Case ${params.environmentCaseId} not found`);
    if (envCase.flowType !== FlowType.ENVIRONMENT) {
      throw new NotFoundException(`Case ${params.environmentCaseId} is not an ENVIRONMENT case`);
    }

    const blueprint = await this.onboarding.getEngineeringHandoff(params.onboardingCaseId);
    if (!blueprint) return null;

    const intake = intakeFromOnboardingHandoff(blueprint);

    const form = await this.resolveForm(
      ENVIRONMENT_INTAKE_FORM_CODE,
      '環境建置接收（導入移交）',
      '自導入移交帶入的客戶 / 銷售模式 / 產出引用，含建置分支，append-only（§6.2 步驟1）',
    );
    await this.prisma.formSubmission.create({
      data: {
        formDefinitionId: form.id,
        caseId: params.environmentCaseId,
        status: SubmissionStatus.SUBMITTED,
        data: serializeEnvironmentIntake(intake) as never,
        submittedById: params.receivedById ?? null,
        submittedAt: new Date(),
      },
      select: { id: true },
    });

    return intake;
  }

  /** 取回某環境建置案件最近一次落地的接收 intake。 */
  async getIntake(caseId: string): Promise<EnvironmentIntake | null> {
    const form = await this.prisma.formDefinition.findFirst({
      where: { code: ENVIRONMENT_INTAKE_FORM_CODE },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!form) return null;
    const sub = await this.prisma.formSubmission.findFirst({
      where: { caseId, formDefinitionId: form.id },
      orderBy: { createdAt: 'desc' },
      select: { data: true },
    });
    return sub ? (deserializeEnvironmentIntake(sub.data) as EnvironmentIntake) : null;
  }

  /**
   * 記錄買斷制主機採購狀態（§6.3「等待客戶採購主機」可記錄）。append-only。
   * - procured=false：仍在等待 → 案件標記為 ON_HOLD（等待採購）。
   * - procured=true：主機已備 → 案件回到 IN_PROGRESS，可開始主機建置。
   * 回傳就緒判斷（依案件 saleMode）。
   */
  async recordHostProcurement(params: {
    environmentCaseId: string;
    procured: boolean;
    note?: string;
    recordedById?: string | null;
  }): Promise<HostReadiness> {
    const envCase = await this.prisma.case.findUnique({
      where: { id: params.environmentCaseId },
      select: { id: true, saleMode: true },
    });
    if (!envCase) throw new NotFoundException(`Case ${params.environmentCaseId} not found`);

    const form = await this.resolveForm(
      ENV_HOST_PROCUREMENT_FORM_CODE,
      '主機採購狀態（買斷）',
      '買斷制客戶端主機採購等待 / 完成狀態紀錄，append-only（§6.3）',
    );
    await this.prisma.formSubmission.create({
      data: {
        formDefinitionId: form.id,
        caseId: params.environmentCaseId,
        status: SubmissionStatus.SUBMITTED,
        data: { procured: params.procured, note: params.note ?? null } as never,
        submittedById: params.recordedById ?? null,
        submittedAt: new Date(),
      },
      select: { id: true },
    });

    // 反映等待狀態於案件狀態（§6.3 可記錄等待）。
    await this.prisma.case.update({
      where: { id: params.environmentCaseId },
      data: { status: params.procured ? CaseStatus.IN_PROGRESS : CaseStatus.ON_HOLD },
    });

    return evaluateHostReadiness(envCase.saleMode, params.procured);
  }

  /** 取目前主機採購就緒狀態（讀最近一筆採購紀錄；無紀錄視為未採購）。 */
  async getHostReadiness(caseId: string): Promise<HostReadiness> {
    const envCase = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { saleMode: true },
    });
    if (!envCase) throw new NotFoundException(`Case ${caseId} not found`);
    return evaluateHostReadiness(envCase.saleMode, await this.isHostProcured(caseId));
  }

  /** 讀最近一筆主機採購紀錄，回傳是否已採購（無紀錄＝未採購）。 */
  private async isHostProcured(caseId: string): Promise<boolean> {
    const form = await this.prisma.formDefinition.findFirst({
      where: { code: ENV_HOST_PROCUREMENT_FORM_CODE },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!form) return false;
    const sub = await this.prisma.formSubmission.findFirst({
      where: { caseId, formDefinitionId: form.id },
      orderBy: { createdAt: 'desc' },
      select: { data: true },
    });
    if (!sub) return false;
    const data = sub.data as { procured?: unknown } | null;
    return data?.procured === true;
  }

  /**
   * 提交一筆環境建置表單（§6.2 步驟2/3：建置檢核表 / 租戶開立紀錄 / 驗收表 / 移交清單）。
   * append-only：每次新增一筆 FormSubmission。
   */
  async submitEnvironmentForm(
    caseId: string,
    formCode: string,
    data: Record<string, unknown>,
    submittedById?: string | null,
  ): Promise<{ submissionId: string }> {
    const existing = await this.prisma.case.findUnique({ where: { id: caseId } });
    if (!existing) throw new NotFoundException(`Case ${caseId} not found`);
    const form = await this.resolveForm(formCode, formCode, `環境建置流程表單：${formCode}`);
    const created = await this.prisma.formSubmission.create({
      data: {
        formDefinitionId: form.id,
        caseId,
        status: SubmissionStatus.SUBMITTED,
        data: data as never,
        submittedById: submittedById ?? null,
        submittedAt: new Date(),
      },
      select: { id: true },
    });
    return { submissionId: created.id };
  }

  /** 取某案件每個表單代碼的「最新一筆」狀態投影，供引擎齊備把關（§6.2 步驟3）。 */
  async getFormStatuses(caseId: string): Promise<FormStatusLike[]> {
    const subs = await this.prisma.formSubmission.findMany({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
      select: { status: true, form: { select: { code: true } } },
    });
    const latestByCode = new Map<string, SubmissionStatus>();
    for (const s of subs) {
      const code = s.form.code;
      if (!latestByCode.has(code)) latestByCode.set(code, s.status);
    }
    return [...latestByCode.entries()].map(([formCode, status]) => ({ formCode, status }));
  }

  /**
   * 環境驗收完成（§6.2 步驟3）：在（買斷）主機已採購、分支建置產出齊備且驗收表完成後，
   * 將案件標記為 COMPLETED（環境就緒）。
   *
   * 引擎把關（planAcceptance）不通過會丟 EnvironmentEngineError（host_purchase_pending /
   * branch_forms_incomplete / acceptance_incomplete / sale_mode_required）。
   */
  async completeEnvironment(params: {
    environmentCaseId: string;
  }): Promise<{ environmentCaseId: string; result: EnvironmentAcceptanceResult }> {
    const envCase = await this.prisma.case.findUnique({
      where: { id: params.environmentCaseId },
      select: { id: true, saleMode: true },
    });
    if (!envCase) throw new NotFoundException(`Case ${params.environmentCaseId} not found`);

    const submissions = await this.getFormStatuses(params.environmentCaseId);
    const hostProcured = await this.isHostProcured(params.environmentCaseId);

    const result = planAcceptance({
      saleMode: envCase.saleMode ?? null,
      hostProcured,
      submissions,
    }); // 不通過會丟 EnvironmentEngineError

    await this.prisma.case.update({
      where: { id: params.environmentCaseId },
      data: { status: CaseStatus.COMPLETED },
    });

    return { environmentCaseId: params.environmentCaseId, result };
  }
}
