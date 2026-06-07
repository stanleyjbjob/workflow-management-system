import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SessionUser } from '../auth/auth.service';
import { Permissions } from '../rbac/permissions.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { guardEngine } from '../common/engine-http';
import {
  AssignmentResult,
  ChangeRequestData,
  ChangeRequestInput,
  CustomizationState,
  DeployGateResult,
  FormStatusLike,
  RetestResult,
} from './customization-engine';
import { CustomizationService } from './customization.service';

/**
 * 客製化（需求變更）流程 REST 端點（issue 8.1 #33 第 2 批 / 需求規格 §7）。
 *
 * 沿用 KanbanController / ProjectsController 風格；與 CustomizationService 方法一一對應，
 * 引擎錯誤（request_invalid / forms_incomplete / invalid_transition / retest_not_passed /
 * test_deploy_pending…）經 guardEngine 轉 400（保留 code）。
 *
 * 權限對應：發起需求變更 `case:update`（操作既有 CUSTOMIZATION 案件）；
 * 指派鏈 `case:assign`（CONSULTANT 指派主管、ENG_LEAD 分派工程師）；表單填寫 `form:fill`；
 * 狀態推進（送複測／複測記錄／兩道部署關卡）`case:advance`；查詢 `case:read` / `form:read`。
 *
 * 路由一覽：
 * - POST /customization/cases/:caseId/change-request      顧問發起需求變更單（§7.2 步驟1）
 * - GET  /customization/cases/:caseId/change-request      取回最近一次需求變更單
 * - POST /customization/cases/:caseId/assign-lead         指派工程主管（§7.2 步驟2）
 * - POST /customization/cases/:caseId/assign-engineer     分派工程師（§7.2 步驟3）
 * - POST /customization/cases/:caseId/forms/:formCode     提交流程表單（append-only；§7.2）
 * - GET  /customization/cases/:caseId/form-statuses       各表單最新狀態投影
 * - POST /customization/cases/:caseId/submit-for-retest   送交顧問複測（齊備把關；§7.2 步驟4/5）
 * - POST /customization/cases/:caseId/retest              記錄複測結果（通過／退回循環；§7.3）
 * - POST /customization/cases/:caseId/confirm-test-deploy 確認測試區更新（第一道關卡；§7.2 步驟7）
 * - POST /customization/cases/:caseId/confirm-prod-deploy 確認正式區更新（第二道關卡；§7.2 步驟8）
 * - GET  /customization/cases/:caseId/state               目前流程狀態與退回次數
 */
@Controller('customization')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class CustomizationController {
  constructor(private readonly customization: CustomizationService) {}

  private requireText(value: string | undefined, field: string, code: string): string {
    const v = (value ?? '').trim();
    if (!v) throw new BadRequestException({ code, message: `${field} 必填` });
    return v;
  }

  /** 顧問發起需求變更單（§7.2 步驟1；流程 → PENDING_LEAD_ASSIGN）。 */
  @Post('cases/:caseId/change-request')
  @Permissions('case:update')
  raiseChangeRequest(
    @CurrentUser() user: SessionUser,
    @Param('caseId') caseId: string,
    @Body() body: ChangeRequestInput,
  ): Promise<{ request: ChangeRequestData; state: CustomizationState }> {
    return guardEngine(() =>
      this.customization.raiseChangeRequest({
        caseId,
        input: body ?? ({} as ChangeRequestInput),
        raisedById: user.sub,
      }),
    );
  }

  /** 取回最近一次需求變更單（無則 null）。 */
  @Get('cases/:caseId/change-request')
  @Permissions('case:read')
  getChangeRequest(@Param('caseId') caseId: string): Promise<ChangeRequestData | null> {
    return guardEngine(() => this.customization.getChangeRequest(caseId));
  }

  /** 顧問指派工程主管（§7.2 步驟2；流程 → PENDING_ENGINEER_ASSIGN）。 */
  @Post('cases/:caseId/assign-lead')
  @Permissions('case:assign')
  assignLead(
    @Param('caseId') caseId: string,
    @Body() body: { assigneeId?: string },
  ): Promise<{ assignment: AssignmentResult; state: CustomizationState }> {
    return guardEngine(() =>
      this.customization.assignEngLead({
        caseId,
        assigneeId: this.requireText(body?.assigneeId, 'assigneeId', 'assignee_required'),
      }),
    );
  }

  /** 工程主管分派工程師（§7.2 步驟3；流程 → IN_DEVELOPMENT）。 */
  @Post('cases/:caseId/assign-engineer')
  @Permissions('case:assign')
  assignEngineer(
    @Param('caseId') caseId: string,
    @Body() body: { assigneeId?: string },
  ): Promise<{ assignment: AssignmentResult; state: CustomizationState }> {
    return guardEngine(() =>
      this.customization.assignEngineer({
        caseId,
        assigneeId: this.requireText(body?.assigneeId, 'assigneeId', 'assignee_required'),
      }),
    );
  }

  /** 提交流程表單（開發任務單／開發紀錄／測試文件／各區更新紀錄，append-only；§7.2）。 */
  @Post('cases/:caseId/forms/:formCode')
  @Permissions('form:fill')
  submitForm(
    @CurrentUser() user: SessionUser,
    @Param('caseId') caseId: string,
    @Param('formCode') formCode: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ submissionId: string }> {
    return guardEngine(() => this.customization.submitForm(caseId, formCode, body ?? {}, user.sub));
  }

  /** 各表單代碼之最新狀態投影（供齊備把關檢視）。 */
  @Get('cases/:caseId/form-statuses')
  @Permissions('form:read')
  getFormStatuses(@Param('caseId') caseId: string): Promise<FormStatusLike[]> {
    return guardEngine(() => this.customization.getFormStatuses(caseId));
  }

  /** 送交顧問複測（開發紀錄＋測試文件齊備把關；流程 → IN_RETEST；§7.2 步驟4/5）。 */
  @Post('cases/:caseId/submit-for-retest')
  @Permissions('case:advance')
  submitForRetest(@Param('caseId') caseId: string): Promise<{ state: CustomizationState }> {
    return guardEngine(() => this.customization.submitForRetest({ caseId }));
  }

  /** 顧問記錄複測結果（§7.3）：通過 → DEPLOYING_TEST；不通過 → 退回 IN_DEVELOPMENT（退回循環）。 */
  @Post('cases/:caseId/retest')
  @Permissions('case:advance')
  recordRetest(
    @CurrentUser() user: SessionUser,
    @Param('caseId') caseId: string,
    @Body() body: { passed?: boolean; reportData?: Record<string, unknown> },
  ): Promise<{ result: RetestResult; state: CustomizationState }> {
    if (typeof body?.passed !== 'boolean') {
      throw new BadRequestException({ code: 'passed_required', message: 'passed（true/false）必填' });
    }
    return guardEngine(() =>
      this.customization.recordRetest({
        caseId,
        passed: body.passed as boolean,
        reportData: body?.reportData,
        consultantId: user.sub,
      }),
    );
  }

  /** 確認測試區更新（第一道關卡；流程 → DEPLOYING_PROD；§7.2 步驟7）。 */
  @Post('cases/:caseId/confirm-test-deploy')
  @Permissions('case:advance')
  confirmTestDeploy(
    @Param('caseId') caseId: string,
  ): Promise<{ gate: DeployGateResult; state: CustomizationState }> {
    return guardEngine(() => this.customization.confirmTestDeploy({ caseId }));
  }

  /** 確認正式區更新（第二道關卡；流程 → COMPLETED，案件 → COMPLETED；§7.2 步驟8）。 */
  @Post('cases/:caseId/confirm-prod-deploy')
  @Permissions('case:advance')
  confirmProdDeploy(
    @Param('caseId') caseId: string,
  ): Promise<{ gate: DeployGateResult; state: CustomizationState }> {
    return guardEngine(() => this.customization.confirmProdDeploy({ caseId }));
  }

  /** 目前流程狀態與退回次數（§7.3 退回循環追蹤）。 */
  @Get('cases/:caseId/state')
  @Permissions('case:read')
  async getState(
    @Param('caseId') caseId: string,
  ): Promise<{ state: CustomizationState; returnCount: number }> {
    return guardEngine(async () => {
      const [state, returnCount] = await Promise.all([
        this.customization.getState(caseId),
        this.customization.getReturnCount(caseId),
      ]);
      return { state, returnCount };
    });
  }
}
