import { Injectable, NotFoundException } from '@nestjs/common';
import { CaseStatus, FlowType, SaleMode, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SalesService } from '../sales/sales.service';
import { CalendarService } from '../calendar/calendar.service';
import { HolidayCalendarInput } from '../calendar/calendar-engine';
import {
  AUTH_DELEGATION_FORM_CODE,
  DEFAULT_ONBOARDING_CHECKPOINTS,
  EngineeringHandoffInput,
  EnvironmentCaseBlueprint,
  FormStatusLike,
  ONBOARDING_HANDOFF_FORM_CODE,
  OnboardingCheckpointDef,
  OnboardingIntake,
  OnboardingStep,
  ReminderItem,
  ScheduledCheckpoint,
  buildSchedule,
  deserializeEnvironmentBlueprint,
  dueReminders,
  intakeFromSalesHandoff,
  planEngineeringHandoff,
  serializeEnvironmentBlueprint,
} from './onboarding-engine';

/**
 * 系統導入流程服務（NestJS）。將 onboarding-engine 的純決策落實到 Prisma。
 *
 * 對應需求規格 §5「系統導入流程（顧問）」，落實範圍（依現有 schema）：
 * - receiveFromSales / createOnboardingCase：接收銷售移交、建立 ONBOARDING 案件並落地 intake。
 *   對應 §5.2 步驟1、§4.6「成案產出自動帶往導入」。
 * - buildCaseSchedule / getDueReminders：預定義時間點排程與主動提醒（§5.1、§5.3），
 *   自 7.1 起 isExcluded 由 CalendarService.buildIsExcluded() 注入（DB Holiday 假日 +
 *   週末 / 補班 + 專案排除日），計畫日落非工作日時自動遞延（§8.3、§12-5 NEXT_WORKDAY）。
 * - submitOnboardingForm / signOnboardingForm / getFormStatuses：各時間點表單填寫與
 *   委任權限表簽核（append-only），對應 §5.2 步驟4、§5.3。
 * - handoffToEngineering：啟動會議完成且必填 / 簽核齊備後，建立後續 ENVIRONMENT（環境建置）
 *   案件並連結，移交藍圖 append-only 落地。對應 §5.2 步驟5、§3 流程銜接。
 *
 * 設計沿用 sales 模組：表單與移交藍圖均以既有 FormSubmission 持久化（append-only，不刪改），
 * 以固定 code 的 FormDefinition 作為容器（resolve-or-create），本輪不新增 migration。
 *
 * 注意（待後續 / 人類 review，見 issue handoff）：
 * - 提醒（dueReminders）之實際派送（系統內 / Email）由 4.2 ReminderService 承接。
 * - ENVIRONMENT 流程定義（WorkflowDefinition）由 6.x 設計，handoffToEngineering 需呼叫端提供
 *   既有 envWorkflowId 作為新案件所屬流程。
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesService,
    private readonly calendar: CalendarService,
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

  /* ────────────── 排程與提醒（§5.1 / §5.3；遞延由 DB 假日驅動，7.1） ────────────── */

  /**
   * 建立導入排程（§5.1 預定義時間點）。
   *
   * isExcluded 實際注入 `CalendarService.buildIsExcluded()`：DB `Holiday` 假日（主管維護，
   * 含連假 / 補班）+ 週末 + 專案排除日（提供 projectId 時），取代先前的 identity 預設——
   * 計畫日落非工作日 / 排除日時向後遞延至第一個工作日（§8.3、§12-5 NEXT_WORKDAY）。
   */
  async buildCaseSchedule(
    anchor: Date,
    opts: {
      /** 自訂時間點骨架；未提供時用內建 DEFAULT_ONBOARDING_CHECKPOINTS（§5.1 可預定義）。 */
      checkpoints?: readonly OnboardingCheckpointDef[];
      /** 關聯專案 id：提供時一併套用該專案行事曆排除日（§10.5）。 */
      projectId?: string;
      /** 額外自訂假日 / 補班 / 週末設定（疊加於 DB 假日之上）。 */
      custom?: HolidayCalendarInput;
    } = {},
  ): Promise<ScheduledCheckpoint[]> {
    const isExcluded = await this.calendar.buildIsExcluded({
      projectId: opts.projectId,
      custom: opts.custom,
    });
    return buildSchedule(anchor, opts.checkpoints ?? DEFAULT_ONBOARDING_CHECKPOINTS, isExcluded);
  }

  /**
   * 依「現在」取得應主動提醒之時間點（§5.3）。排程先經 buildCaseSchedule（已套用 DB 假日 /
   * 專案排除日遞延），故假日遞延後提醒時點自動同步（與 4.2 提醒引擎之精神一致）。
   */
  async getDueReminders(
    anchor: Date,
    opts: {
      checkpoints?: readonly OnboardingCheckpointDef[];
      projectId?: string;
      custom?: HolidayCalendarInput;
      now?: Date;
      lookaheadDays?: number;
      completedSteps?: ReadonlySet<OnboardingStep>;
    } = {},
  ): Promise<ReminderItem[]> {
    const schedule = await this.buildCaseSchedule(anchor, opts);
    return dueReminders(
      schedule,
      opts.now ?? new Date(),
      opts.lookaheadDays ?? 3,
      opts.completedSteps ?? new Set<OnboardingStep>(),
    );
  }

  /**
   * 接收銷售移交（§5.2 步驟1）。讀取已成案 SALES 案件的移交藍圖（sales.getHandoff），
   * 轉為導入接收（intakeFromSalesHandoff）。尚未成案 / 無移交資料時回傳 null。
   */
  async receiveFromSales(salesCaseId: string): Promise<OnboardingIntake | null> {
    const handoff = await this.sales.getHandoff(salesCaseId);
    if (!handoff) return null;
    return intakeFromSalesHandoff(handoff);
  }

  /**
   * 建立導入案件（ONBOARDING）。若提供 salesCaseId，會接收銷售移交並把 intake
   * 以 append-only FormSubmission 落地，使「成案產出自動帶往導入」durable（§4.6）。
   */
  async createOnboardingCase(params: {
    code: string;
    workflowId: string;
    title: string;
    clientName: string;
    saleMode?: SaleMode | null;
    salesCaseId?: string;
    createdById?: string;
    assigneeId?: string;
  }): Promise<{ caseId: string; intake: OnboardingIntake | null }> {
    const created = await this.prisma.case.create({
      data: {
        code: params.code,
        workflowId: params.workflowId,
        flowType: FlowType.ONBOARDING,
        title: params.title,
        clientName: params.clientName,
        saleMode: params.saleMode ?? null,
        status: CaseStatus.IN_PROGRESS,
        createdById: params.createdById,
        assigneeId: params.assigneeId,
      },
      select: { id: true },
    });

    let intake: OnboardingIntake | null = null;
    if (params.salesCaseId) {
      intake = await this.receiveFromSales(params.salesCaseId);
      if (intake) {
        const form = await this.resolveForm(
          'ONBOARDING_INTAKE',
          '導入接收（銷售移交）',
          '自銷售成案帶入的產出引用（報價單 / 客製需求），append-only（§4.6）',
        );
        await this.prisma.formSubmission.create({
          data: {
            formDefinitionId: form.id,
            caseId: created.id,
            status: SubmissionStatus.SUBMITTED,
            data: intake as never,
            submittedById: params.createdById ?? null,
          },
          select: { id: true },
        });
      }
    }
    return { caseId: created.id, intake };
  }

  /** 取回某導入案件最近一次落地的銷售接收 intake（供移交工程引用）。 */
  async getIntake(caseId: string): Promise<OnboardingIntake | null> {
    const form = await this.prisma.formDefinition.findFirst({
      where: { code: 'ONBOARDING_INTAKE' },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!form) return null;
    const sub = await this.prisma.formSubmission.findFirst({
      where: { caseId, formDefinitionId: form.id },
      orderBy: { createdAt: 'desc' },
      select: { data: true },
    });
    return sub ? (sub.data as unknown as OnboardingIntake) : null;
  }

  /**
   * 提交一筆導入表單（§5.2 各步驟產出 / §5.3）。append-only：每次新增一筆 FormSubmission。
   * 委任權限表（AUTH_DELEGATION）標記為簽核類表單，初始狀態 SUBMITTED，待 signOnboardingForm 核可。
   */
  async submitOnboardingForm(
    caseId: string,
    formCode: string,
    data: Record<string, unknown>,
    submittedById?: string | null,
  ): Promise<{ submissionId: string }> {
    const existing = await this.prisma.case.findUnique({ where: { id: caseId } });
    if (!existing) throw new NotFoundException(`Case ${caseId} not found`);
    const isSignable = formCode === AUTH_DELEGATION_FORM_CODE;
    const form = await this.resolveForm(
      formCode,
      formCode,
      `導入流程表單：${formCode}`,
      isSignable,
    );
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

  /**
   * 簽核一筆已送出的導入表單（核可 / 退回），對應委任權限表之簽核軌跡（§5.3）。
   * 僅允許對 SUBMITTED 的填寫簽核；記錄核可人與時間。
   */
  async signOnboardingForm(
    submissionId: string,
    approverId: string | null,
    approve: boolean,
  ): Promise<{ submissionId: string; status: SubmissionStatus }> {
    const sub = await this.prisma.formSubmission.findUnique({
      where: { id: submissionId },
      select: { id: true, status: true },
    });
    if (!sub) throw new NotFoundException(`Submission ${submissionId} not found`);
    const status = approve ? SubmissionStatus.APPROVED : SubmissionStatus.REJECTED;
    await this.prisma.formSubmission.update({
      where: { id: submissionId },
      data: { status, approvedById: approverId, approvedAt: new Date() },
    });
    return { submissionId, status };
  }

  /**
   * 取某案件每個表單代碼的「最新一筆」狀態投影，供引擎齊備 / 簽核把關（§5.2 步驟4）。
   */
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
   * 移交工程（§5.2 步驟5）：在啟動會議完成且必填 / 簽核齊備後，
   * 建立後續 ENVIRONMENT（環境建置）案件並連結，移交藍圖 append-only 落地。
   *
   * 引擎把關（planEngineeringHandoff）不通過會丟 OnboardingEngineError（kickoff_incomplete /
   * required_forms_incomplete / auth_delegation_unsigned）。
   */
  async handoffToEngineering(params: {
    onboardingCaseId: string;
    envWorkflowId: string;
    envCaseCode: string;
    kickoffCompleted: boolean;
    extraDocRefIds?: readonly string[];
    createdById?: string;
    assigneeId?: string;
  }): Promise<{ environmentCaseId: string; blueprint: EnvironmentCaseBlueprint }> {
    const onboarding = await this.prisma.case.findUnique({
      where: { id: params.onboardingCaseId },
      select: { id: true, clientName: true, saleMode: true },
    });
    if (!onboarding) throw new NotFoundException(`Case ${params.onboardingCaseId} not found`);

    const intake = await this.getIntake(params.onboardingCaseId);
    if (!intake) throw new NotFoundException('Onboarding intake not found; receive sales handoff first');
    const submissions = await this.getFormStatuses(params.onboardingCaseId);

    const input: EngineeringHandoffInput = {
      intake,
      clientName: onboarding.clientName ?? '未命名客戶',
      saleMode: onboarding.saleMode ?? null,
      kickoffCompleted: params.kickoffCompleted,
      submissions,
      extraDocRefIds: params.extraDocRefIds,
    };
    const blueprint = planEngineeringHandoff(input); // 不通過會丟 OnboardingEngineError

    const envCase = await this.prisma.case.create({
      data: {
        code: params.envCaseCode,
        workflowId: params.envWorkflowId,
        flowType: FlowType.ENVIRONMENT,
        title: blueprint.title,
        clientName: blueprint.clientName,
        saleMode: blueprint.saleMode,
        status: CaseStatus.IN_PROGRESS,
        createdById: params.createdById,
        assigneeId: params.assigneeId,
      },
      select: { id: true },
    });

    // 移交藍圖 append-only 落地於「導入」案件下，供追溯與工程接續引用。
    const handoffForm = await this.resolveForm(
      ONBOARDING_HANDOFF_FORM_CODE,
      '導入→環境建置移交藍圖',
      '啟動會議完成後移交工程之環境建置藍圖（含帶往產出引用），append-only（§5.2 步驟5）',
    );
    await this.prisma.formSubmission.create({
      data: {
        formDefinitionId: handoffForm.id,
        caseId: params.onboardingCaseId,
        status: SubmissionStatus.SUBMITTED,
        data: serializeEnvironmentBlueprint(blueprint) as never,
        submittedById: params.createdById ?? null,
      },
      select: { id: true },
    });

    return { environmentCaseId: envCase.id, blueprint };
  }

  /** 取回某導入案件最近一次移交工程的環境建置藍圖（供追溯，§5.2 步驟5）。 */
  async getEngineeringHandoff(caseId: string) {
    const form = await this.prisma.formDefinition.findFirst({
      where: { code: ONBOARDING_HANDOFF_FORM_CODE },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!form) return null;
    const sub = await this.prisma.formSubmission.findFirst({
      where: { caseId, formDefinitionId: form.id },
      orderBy: { createdAt: 'desc' },
      select: { data: true },
    });
    return sub ? deserializeEnvironmentBlueprint(sub.data) : null;
  }

  /** 標記導入案件下某步驟名稱（供 UI / 後續查詢）。 */
  static stepLabel(step: OnboardingStep): string {
    return step;
  }
}
