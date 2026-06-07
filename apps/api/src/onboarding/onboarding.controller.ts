import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SaleMode } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SessionUser } from '../auth/auth.service';
import { Permissions } from '../rbac/permissions.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { guardEngine } from '../common/engine-http';
import { HolidayCalendarInput } from '../calendar/calendar-engine';
import {
  EnvironmentCaseBlueprint,
  FormStatusLike,
  OnboardingCheckpointDef,
  OnboardingIntake,
  OnboardingStep,
  ReminderItem,
  ScheduledCheckpoint,
} from './onboarding-engine';
import { OnboardingService } from './onboarding.service';

/**
 * 系統導入流程 REST 端點（issue 8.1 #33 第 2 批 / 需求規格 §5）。
 *
 * 沿用 KanbanController / ProjectsController 風格；與 OnboardingService 方法一一對應，
 * 引擎錯誤（kickoff_incomplete / required_forms_incomplete / auth_delegation_unsigned…）
 * 經 guardEngine 轉 400（保留 code）。
 *
 * 權限對應：建立案件 `case:create`；表單填寫 `form:fill`；委任權限表簽核 `form:approve`
 * （CONSULTANT / MANAGER）；移交工程（狀態推進）`case:advance`；查詢 `case:read` / `form:read`。
 *
 * 路由一覽：
 * - POST /onboarding/cases                                建立導入案件（可帶 salesCaseId 接收銷售移交；§5.2 步驟1）
 * - GET  /onboarding/sales-handoff/:salesCaseId           預覽銷售移交內容（未落地；§4.6→§5.2）
 * - GET  /onboarding/cases/:caseId/intake                 取回已落地之銷售接收 intake
 * - POST /onboarding/cases/:caseId/forms/:formCode        提交導入表單（append-only；§5.2／§5.3）
 * - POST /onboarding/submissions/:submissionId/sign       簽核表單（委任權限表核可／退回；§5.3）
 * - GET  /onboarding/cases/:caseId/form-statuses          各表單最新狀態投影
 * - POST /onboarding/cases/:caseId/handoff-to-engineering 移交工程（建立 ENVIRONMENT 案件；§5.2 步驟5）
 * - GET  /onboarding/cases/:caseId/engineering-handoff    取回移交工程藍圖（追溯）
 * - POST /onboarding/schedule                             計算導入排程（純計算，DB 假日遞延；§5.1、§12-5）
 * - POST /onboarding/reminders                            計算應提醒時間點（純計算；§5.3）
 *
 * 註：schedule / reminders 為純計算端點（不寫入），以 POST 承載結構化參數
 * （checkpoints / custom 行事曆覆寫無法以 query 合理表達）。
 */
@Controller('onboarding')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  /** body 必填日期解析；非法／缺漏一律 400（與 query 慣例一致）。 */
  private parseRequiredDate(value: string | undefined, field: string): Date {
    if (value == null || value === '') {
      throw new BadRequestException({ code: 'invalid_body', message: `${field} 必填（ISO 日期）` });
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException({ code: 'invalid_body', message: `${field} 不是合法日期：${value}` });
    }
    return d;
  }

  private parseOptionalDate(value: string | undefined, field: string): Date | undefined {
    if (value == null || value === '') return undefined;
    return this.parseRequiredDate(value, field);
  }

  private requireText(value: string | undefined, field: string, code: string): string {
    const v = (value ?? '').trim();
    if (!v) throw new BadRequestException({ code, message: `${field} 必填` });
    return v;
  }

  /** 建立導入案件（§5.2 步驟1）。提供 salesCaseId 時自動接收銷售移交並落地 intake。 */
  @Post('cases')
  @Permissions('case:create')
  createCase(
    @CurrentUser() user: SessionUser,
    @Body()
    body: {
      code?: string;
      workflowId?: string;
      title?: string;
      clientName?: string;
      saleMode?: string;
      salesCaseId?: string;
      assigneeId?: string;
    },
  ): Promise<{ caseId: string; intake: OnboardingIntake | null }> {
    let saleMode: SaleMode | undefined;
    if (body?.saleMode != null && body.saleMode !== '') {
      const all = Object.values(SaleMode) as string[];
      if (!all.includes(body.saleMode)) {
        throw new BadRequestException({ code: 'invalid_body', message: `saleMode 必須為 ${all.join(' / ')}：${body.saleMode}` });
      }
      saleMode = body.saleMode as SaleMode;
    }
    return guardEngine(() =>
      this.onboarding.createOnboardingCase({
        code: this.requireText(body?.code, '案件代碼 code', 'code_required'),
        workflowId: this.requireText(body?.workflowId, 'workflowId', 'workflow_required'),
        title: this.requireText(body?.title, 'title', 'title_required'),
        clientName: this.requireText(body?.clientName, 'clientName', 'client_required'),
        saleMode,
        salesCaseId: body?.salesCaseId,
        createdById: user.sub,
        assigneeId: body?.assigneeId,
      }),
    );
  }

  /** 預覽銷售移交內容（不落地；尚未成案回傳 null）。 */
  @Get('sales-handoff/:salesCaseId')
  @Permissions('case:read')
  previewSalesHandoff(@Param('salesCaseId') salesCaseId: string): Promise<OnboardingIntake | null> {
    return guardEngine(() => this.onboarding.receiveFromSales(salesCaseId));
  }

  /** 取回已落地之銷售接收 intake（供移交工程引用）。 */
  @Get('cases/:caseId/intake')
  @Permissions('case:read')
  getIntake(@Param('caseId') caseId: string): Promise<OnboardingIntake | null> {
    return guardEngine(() => this.onboarding.getIntake(caseId));
  }

  /** 提交導入表單（append-only；委任權限表為簽核類，待 sign 端點核可；§5.2／§5.3）。 */
  @Post('cases/:caseId/forms/:formCode')
  @Permissions('form:fill')
  submitForm(
    @CurrentUser() user: SessionUser,
    @Param('caseId') caseId: string,
    @Param('formCode') formCode: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ submissionId: string }> {
    return guardEngine(() => this.onboarding.submitOnboardingForm(caseId, formCode, body ?? {}, user.sub));
  }

  /** 簽核一筆已送出的表單（approve=true 核可／false 退回；§5.3 委任權限表簽核軌跡）。 */
  @Post('submissions/:submissionId/sign')
  @Permissions('form:approve')
  sign(
    @CurrentUser() user: SessionUser,
    @Param('submissionId') submissionId: string,
    @Body() body: { approve?: boolean },
  ): Promise<unknown> {
    if (typeof body?.approve !== 'boolean') {
      throw new BadRequestException({ code: 'approve_required', message: 'approve（true/false）必填' });
    }
    return guardEngine(() => this.onboarding.signOnboardingForm(submissionId, user.sub, body.approve as boolean));
  }

  /** 各表單代碼之最新狀態投影（供齊備／簽核把關檢視）。 */
  @Get('cases/:caseId/form-statuses')
  @Permissions('form:read')
  getFormStatuses(@Param('caseId') caseId: string): Promise<FormStatusLike[]> {
    return guardEngine(() => this.onboarding.getFormStatuses(caseId));
  }

  /** 移交工程（§5.2 步驟5）：把關通過後建立 ENVIRONMENT 案件並回傳藍圖。 */
  @Post('cases/:caseId/handoff-to-engineering')
  @Permissions('case:advance')
  handoffToEngineering(
    @CurrentUser() user: SessionUser,
    @Param('caseId') caseId: string,
    @Body()
    body: {
      envWorkflowId?: string;
      envCaseCode?: string;
      kickoffCompleted?: boolean;
      extraDocRefIds?: string[];
      assigneeId?: string;
    },
  ): Promise<{ environmentCaseId: string; blueprint: EnvironmentCaseBlueprint }> {
    return guardEngine(() =>
      this.onboarding.handoffToEngineering({
        onboardingCaseId: caseId,
        envWorkflowId: this.requireText(body?.envWorkflowId, 'envWorkflowId', 'workflow_required'),
        envCaseCode: this.requireText(body?.envCaseCode, 'envCaseCode', 'code_required'),
        kickoffCompleted: body?.kickoffCompleted === true,
        extraDocRefIds: body?.extraDocRefIds,
        createdById: user.sub,
        assigneeId: body?.assigneeId,
      }),
    );
  }

  /** 取回最近一次移交工程之環境建置藍圖（追溯；§5.2 步驟5）。 */
  @Get('cases/:caseId/engineering-handoff')
  @Permissions('case:read')
  getEngineeringHandoff(@Param('caseId') caseId: string): Promise<EnvironmentCaseBlueprint | null> {
    return guardEngine(() => this.onboarding.getEngineeringHandoff(caseId));
  }

  /** 計算導入排程（純計算；DB 假日＋專案排除日遞延，§5.1、§8.3、§12-5 NEXT_WORKDAY）。 */
  @Post('schedule')
  @Permissions('case:read')
  buildSchedule(
    @Body()
    body: {
      anchor?: string;
      checkpoints?: OnboardingCheckpointDef[];
      projectId?: string;
      custom?: HolidayCalendarInput;
    },
  ): Promise<ScheduledCheckpoint[]> {
    const anchor = this.parseRequiredDate(body?.anchor, 'anchor');
    return guardEngine(() =>
      this.onboarding.buildCaseSchedule(anchor, {
        checkpoints: body?.checkpoints,
        projectId: body?.projectId,
        custom: body?.custom,
      }),
    );
  }

  /** 計算應主動提醒之時間點（純計算；遞延後提醒時點自動同步，§5.3）。 */
  @Post('reminders')
  @Permissions('case:read')
  getDueReminders(
    @Body()
    body: {
      anchor?: string;
      now?: string;
      lookaheadDays?: number;
      completedSteps?: string[];
      checkpoints?: OnboardingCheckpointDef[];
      projectId?: string;
      custom?: HolidayCalendarInput;
    },
  ): Promise<ReminderItem[]> {
    const anchor = this.parseRequiredDate(body?.anchor, 'anchor');
    if (body?.lookaheadDays != null && (!Number.isInteger(body.lookaheadDays) || body.lookaheadDays < 0)) {
      throw new BadRequestException({ code: 'invalid_body', message: `lookaheadDays 必須為非負整數：${body.lookaheadDays}` });
    }
    return guardEngine(() =>
      this.onboarding.getDueReminders(anchor, {
        checkpoints: body?.checkpoints,
        projectId: body?.projectId,
        custom: body?.custom,
        now: this.parseOptionalDate(body?.now, 'now'),
        lookaheadDays: body?.lookaheadDays,
        completedSteps: body?.completedSteps
          ? new Set(body.completedSteps as OnboardingStep[])
          : undefined,
      }),
    );
  }
}
