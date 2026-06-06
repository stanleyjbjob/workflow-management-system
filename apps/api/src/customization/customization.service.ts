import { Injectable, NotFoundException } from '@nestjs/common';
import { CaseStatus, FlowType, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AssignmentResult,
  ChangeRequestData,
  ChangeRequestInput,
  CustomizationAction,
  CustomizationState,
  CUSTOMIZATION_REQUEST_FORM_CODE,
  DeployGateResult,
  FormStatusLike,
  RetestResult,
  ROLE_ENGINEER,
  ROLE_ENG_LEAD,
  applyRetestResult,
  buildChangeRequest,
  deserializeChangeRequest,
  planAssignEngineer,
  planAssignLead,
  planProductionDeployment,
  planSubmitForRetest,
  planTestDeployment,
  serializeChangeRequest,
} from './customization-engine';

/**
 * 客製化（需求變更）流程服務（NestJS）。將 customization-engine 的純決策落實到 Prisma。
 *
 * 對應需求規格 §7「客製化（需求變更）流程」，落實範圍（依現有 schema、不新增 migration）：
 * - raiseChangeRequest：顧問發起需求變更單，append-only 落地（§7.2 步驟1）。
 * - assignEngLead / assignEngineer：指派鏈（顧問→工程主管→工程師），以 Case.assigneeId 反映目前負責人，
 *   引擎 planAssign* 比對被指派人角色（§7.2 步驟2/3）。
 * - submitForm：步驟產出（開發任務單 / 開發紀錄 / 測試文件 / 各區更新紀錄）append-only（§7.2、§8.2）。
 * - submitForRetest：開發紀錄＋測試文件齊備後送顧問複測（§7.2 步驟4/5/6）。
 * - recordRetest：複測通過→進測試區；不通過→退回開發（StepInstanceStatus.RETURNED 語意），形成循環（§7.3）。
 * - confirmTestDeploy / confirmProdDeploy：測試區→正式區兩道關卡分別把關與記錄（§7.2 步驟7/8、§7.3）。
 *
 * 流程狀態（CustomizationState）以 append-only 的「狀態事件」表單（CUSTOMIZATION_STATE）持久化，
 * 讀最近一筆還原目前狀態、統計退回次數；與 environment 模組以 FormSubmission 落地的風格一致。
 * Case.status（CaseStatus）另反映案件生命週期（IN_PROGRESS / COMPLETED）供專案管理(5.x)甘特圖可見。
 *
 * 注意（待後續 / 人類 review）：
 * - CUSTOMIZATION 流程定義（WorkflowDefinition）由 8.x / 流程設計器產生；本服務操作既有 CUSTOMIZATION 案件
 *   （caseId 由呼叫端提供），不在此建立 Case / Workflow。
 * - 指派核可關卡（§12-1）、各步驟簽核（§12-4）尚未強制；引擎已保留把關介面。
 */
@Injectable()
export class CustomizationService {
  constructor(private readonly prisma: PrismaService) {}

  /** 狀態事件表單代碼（append-only 狀態機事件日誌）。 */
  private static readonly STATE_FORM_CODE = 'CUSTOMIZATION_STATE';

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

  /** 確認案件存在且為 CUSTOMIZATION 流程。 */
  private async requireCustomizationCase(caseId: string): Promise<{ id: string }> {
    const c = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { id: true, flowType: true },
    });
    if (!c) throw new NotFoundException(`Case ${caseId} not found`);
    if (c.flowType !== FlowType.CUSTOMIZATION) {
      throw new NotFoundException(`Case ${caseId} is not a CUSTOMIZATION case`);
    }
    return { id: c.id };
  }

  /** append-only 寫入一筆狀態事件並回傳新狀態。 */
  private async recordState(
    caseId: string,
    state: CustomizationState,
    action: CustomizationAction | null,
    returned: boolean,
    byId?: string | null,
  ): Promise<CustomizationState> {
    const form = await this.resolveForm(
      CustomizationService.STATE_FORM_CODE,
      '客製化流程狀態事件',
      '客製化流程狀態機事件日誌（append-only，記錄狀態 / 動作 / 退回）',
    );
    await this.prisma.formSubmission.create({
      data: {
        formDefinitionId: form.id,
        caseId,
        status: SubmissionStatus.SUBMITTED,
        data: { state, action, returned } as never,
        submittedById: byId ?? null,
        submittedAt: new Date(),
      },
      select: { id: true },
    });
    return state;
  }

  /** 取目前流程狀態（無事件＝DRAFT）。 */
  async getState(caseId: string): Promise<CustomizationState> {
    const form = await this.prisma.formDefinition.findFirst({
      where: { code: CustomizationService.STATE_FORM_CODE },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!form) return CustomizationState.DRAFT;
    const sub = await this.prisma.formSubmission.findFirst({
      where: { caseId, formDefinitionId: form.id },
      orderBy: { createdAt: 'desc' },
      select: { data: true },
    });
    const s = (sub?.data as { state?: unknown } | null)?.state;
    return typeof s === 'string' && (Object.values(CustomizationState) as string[]).includes(s)
      ? (s as CustomizationState)
      : CustomizationState.DRAFT;
  }

  /** 統計目前退回次數（狀態事件中 returned=true 的筆數）。 */
  async getReturnCount(caseId: string): Promise<number> {
    const form = await this.prisma.formDefinition.findFirst({
      where: { code: CustomizationService.STATE_FORM_CODE },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!form) return 0;
    const subs = await this.prisma.formSubmission.findMany({
      where: { caseId, formDefinitionId: form.id },
      select: { data: true },
    });
    return subs.filter((s) => (s.data as { returned?: unknown } | null)?.returned === true).length;
  }

  /** 讀某使用者的角色代碼集合（供指派比對）。 */
  private async getUserRoleCodes(userId: string): Promise<string[]> {
    const roles = await this.prisma.userRole.findMany({
      where: { userId },
      select: { role: { select: { code: true } } },
    });
    return roles.map((r) => r.role.code as unknown as string);
  }

  /** 將使用者角色集合投影為單一「比對用角色」：持有期望角色則回傳之，否則回第一個或 null。 */
  private projectRole(roleCodes: string[], expected: string): string | null {
    if (roleCodes.includes(expected)) return expected;
    return roleCodes[0] ?? null;
  }

  /**
   * 顧問發起需求變更單（§7.2 步驟1）。建立並 append-only 落地需求變更單，
   * 案件狀態轉 IN_PROGRESS，流程狀態 → PENDING_LEAD_ASSIGN。
   */
  async raiseChangeRequest(params: {
    caseId: string;
    input: ChangeRequestInput;
    raisedById?: string | null;
  }): Promise<{ request: ChangeRequestData; state: CustomizationState }> {
    await this.requireCustomizationCase(params.caseId);
    const request = buildChangeRequest({
      ...params.input,
      raisedById: params.input.raisedById ?? params.raisedById ?? null,
    });

    const form = await this.resolveForm(
      CUSTOMIZATION_REQUEST_FORM_CODE,
      '需求變更單',
      '客戶上線後客製需求登錄（顧問發起），append-only（§7.2 步驟1）',
    );
    await this.prisma.formSubmission.create({
      data: {
        formDefinitionId: form.id,
        caseId: params.caseId,
        status: SubmissionStatus.SUBMITTED,
        data: serializeChangeRequest(request) as never,
        submittedById: params.raisedById ?? null,
        submittedAt: new Date(),
      },
      select: { id: true },
    });

    await this.prisma.case.update({
      where: { id: params.caseId },
      data: { status: CaseStatus.IN_PROGRESS, clientName: request.clientName, title: request.title },
    });
    const state = await this.recordState(
      params.caseId,
      CustomizationState.PENDING_LEAD_ASSIGN,
      CustomizationAction.SUBMIT_REQUEST,
      false,
      params.raisedById,
    );
    return { request, state };
  }

  /** 取最近一次落地的需求變更單。 */
  async getChangeRequest(caseId: string): Promise<ChangeRequestData | null> {
    const form = await this.prisma.formDefinition.findFirst({
      where: { code: CUSTOMIZATION_REQUEST_FORM_CODE },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!form) return null;
    const sub = await this.prisma.formSubmission.findFirst({
      where: { caseId, formDefinitionId: form.id },
      orderBy: { createdAt: 'desc' },
      select: { data: true },
    });
    return sub ? deserializeChangeRequest(sub.data) : null;
  }

  /** 顧問指派工程主管（§7.2 步驟2）。 */
  async assignEngLead(params: {
    caseId: string;
    assigneeId: string;
  }): Promise<{ assignment: AssignmentResult; state: CustomizationState }> {
    await this.requireCustomizationCase(params.caseId);
    const roleCodes = await this.getUserRoleCodes(params.assigneeId);
    const assignment = planAssignLead({
      assigneeId: params.assigneeId,
      assigneeRole: this.projectRole(roleCodes, ROLE_ENG_LEAD),
    });
    await this.prisma.case.update({
      where: { id: params.caseId },
      data: { assigneeId: params.assigneeId },
    });
    const state = await this.recordState(
      params.caseId,
      CustomizationState.PENDING_ENGINEER_ASSIGN,
      CustomizationAction.ASSIGN_LEAD,
      false,
    );
    return { assignment, state };
  }

  /** 工程主管分派工程師（§7.2 步驟3）。 */
  async assignEngineer(params: {
    caseId: string;
    assigneeId: string;
  }): Promise<{ assignment: AssignmentResult; state: CustomizationState }> {
    await this.requireCustomizationCase(params.caseId);
    const roleCodes = await this.getUserRoleCodes(params.assigneeId);
    const assignment = planAssignEngineer({
      assigneeId: params.assigneeId,
      assigneeRole: this.projectRole(roleCodes, ROLE_ENGINEER),
    });
    await this.prisma.case.update({
      where: { id: params.caseId },
      data: { assigneeId: params.assigneeId },
    });
    const state = await this.recordState(
      params.caseId,
      CustomizationState.IN_DEVELOPMENT,
      CustomizationAction.ASSIGN_ENGINEER,
      false,
    );
    return { assignment, state };
  }

  /**
   * 提交一筆客製化流程表單（開發任務單 / 開發紀錄 / 測試文件 / 複測報告 / 測試區・正式區更新紀錄）。
   * append-only：每次新增一筆 FormSubmission。
   */
  async submitForm(
    caseId: string,
    formCode: string,
    data: Record<string, unknown>,
    submittedById?: string | null,
  ): Promise<{ submissionId: string }> {
    await this.requireCustomizationCase(caseId);
    const form = await this.resolveForm(formCode, formCode, `客製化流程表單：${formCode}`);
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

  /** 取某案件每個表單代碼的「最新一筆」狀態投影，供引擎齊備把關。 */
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
   * 送交複測（§7.2 步驟4/5/6）。把關：開發紀錄＋測試文件齊備（planSubmitForRetest，
   * 不齊備丟 forms_incomplete），流程狀態 → IN_RETEST。
   */
  async submitForRetest(params: { caseId: string }): Promise<{ state: CustomizationState }> {
    await this.requireCustomizationCase(params.caseId);
    const submissions = await this.getFormStatuses(params.caseId);
    planSubmitForRetest(submissions); // 不齊備丟 CustomizationEngineError
    const state = await this.recordState(
      params.caseId,
      CustomizationState.IN_RETEST,
      CustomizationAction.SUBMIT_FOR_RETEST,
      false,
    );
    return { state };
  }

  /**
   * 顧問複測並記錄結果（§7.2 步驟6、§7.3）。append-only 落地複測報告，依結果：
   * - 通過：流程 → DEPLOYING_TEST。
   * - 不通過：流程退回 IN_DEVELOPMENT（returned），退回次數累計。
   * 僅可於 IN_RETEST 套用（否則引擎丟 invalid_transition）。
   */
  async recordRetest(params: {
    caseId: string;
    passed: boolean;
    reportData?: Record<string, unknown>;
    consultantId?: string | null;
  }): Promise<{ result: RetestResult; state: CustomizationState }> {
    await this.requireCustomizationCase(params.caseId);
    const current = await this.getState(params.caseId);
    const prior = await this.getReturnCount(params.caseId);
    const result = applyRetestResult(current, { passed: params.passed, priorReturnCount: prior });

    await this.submitForm(
      params.caseId,
      'CUSTOMIZATION_RETEST_REPORT',
      { passed: params.passed, ...(params.reportData ?? {}) },
      params.consultantId,
    );
    const state = await this.recordState(
      params.caseId,
      result.nextState,
      params.passed ? CustomizationAction.RETEST_PASS : CustomizationAction.RETEST_FAIL,
      result.returned,
      params.consultantId,
    );
    return { result, state };
  }

  /**
   * 確認測試區更新（第一道關卡，§7.2 步驟7）。把關：複測已通過（DEPLOYING_TEST）且測試區更新紀錄齊備
   * （planTestDeployment），流程 → DEPLOYING_PROD。
   */
  async confirmTestDeploy(params: { caseId: string }): Promise<{ gate: DeployGateResult; state: CustomizationState }> {
    await this.requireCustomizationCase(params.caseId);
    const current = await this.getState(params.caseId);
    const submissions = await this.getFormStatuses(params.caseId);
    const gate = planTestDeployment(current, submissions); // 不通過丟 CustomizationEngineError
    const state = await this.recordState(
      params.caseId,
      gate.nextState,
      CustomizationAction.CONFIRM_TEST_DEPLOY,
      false,
    );
    return { gate, state };
  }

  /**
   * 確認正式區更新（第二道關卡，§7.2 步驟8、§7.3）。把關：測試區已確認（DEPLOYING_PROD）且正式區上線紀錄齊備
   * （planProductionDeployment），流程 → COMPLETED，案件 status → COMPLETED。
   */
  async confirmProdDeploy(params: { caseId: string }): Promise<{ gate: DeployGateResult; state: CustomizationState }> {
    await this.requireCustomizationCase(params.caseId);
    const current = await this.getState(params.caseId);
    const submissions = await this.getFormStatuses(params.caseId);
    const gate = planProductionDeployment(current, submissions); // 不通過丟 CustomizationEngineError
    const state = await this.recordState(
      params.caseId,
      gate.nextState,
      CustomizationAction.CONFIRM_PROD_DEPLOY,
      false,
    );
    await this.prisma.case.update({
      where: { id: params.caseId },
      data: { status: CaseStatus.COMPLETED },
    });
    return { gate, state };
  }
}
