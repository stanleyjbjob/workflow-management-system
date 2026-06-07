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
import { HolidayCalendarInput } from '../calendar/calendar-engine';
import { OnboardingCheckpointDef, ScheduledCheckpoint } from '../onboarding/onboarding-engine';
import {
  EnvironmentAcceptanceResult,
  EnvironmentIntake,
  EnvironmentStep,
  FormStatusLike,
  HostReadiness,
} from './environment-engine';
import { EnvironmentService } from './environment.service';

/**
 * 環境建置流程 REST 端點（issue 8.1 #33 第 2 批 / 需求規格 §6）。
 *
 * 沿用 KanbanController / ProjectsController 風格；與 EnvironmentService 方法一一對應，
 * 引擎錯誤（sale_mode_required / host_purchase_pending / branch_forms_incomplete /
 * acceptance_incomplete…）經 guardEngine 轉 400（保留 code）。
 *
 * 權限對應：接收移交／主機採購紀錄 `case:update`；表單填寫 `form:fill`；
 * 驗收完成（狀態推進）`case:advance`；查詢 `case:read` / `form:read`。
 *
 * 路由一覽：
 * - POST /environment/cases/:caseId/receive           接收導入移交（落地 intake；§6.2 步驟1）
 * - GET  /environment/cases/:caseId/intake            取回接收 intake（含建置分支）
 * - POST /environment/cases/:caseId/host-procurement  記錄主機採購狀態（買斷等待；§6.3）
 * - GET  /environment/cases/:caseId/host-readiness    主機就緒判斷（依銷售模式）
 * - POST /environment/cases/:caseId/forms/:formCode   提交建置／驗收表單（append-only；§6.2 步驟2/3）
 * - GET  /environment/cases/:caseId/form-statuses     各表單最新狀態投影
 * - POST /environment/cases/:caseId/complete          環境驗收完成（→COMPLETED；§6.2 步驟3）
 * - POST /environment/schedule                        計算建置排程（純計算；checkpoints 由呼叫端提供，§6／7.1）
 */
@Controller('environment')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class EnvironmentController {
  constructor(private readonly environment: EnvironmentService) {}

  /** 接收導入移交（§6.2 步驟1）。導入案件尚無移交藍圖時回傳 null（不落地）。 */
  @Post('cases/:caseId/receive')
  @Permissions('case:update')
  receive(
    @CurrentUser() user: SessionUser,
    @Param('caseId') caseId: string,
    @Body() body: { onboardingCaseId?: string },
  ): Promise<EnvironmentIntake | null> {
    const onboardingCaseId = (body?.onboardingCaseId ?? '').trim();
    if (!onboardingCaseId) {
      throw new BadRequestException({ code: 'onboarding_case_required', message: 'onboardingCaseId 必填' });
    }
    return guardEngine(() =>
      this.environment.receiveFromOnboarding({
        environmentCaseId: caseId,
        onboardingCaseId,
        receivedById: user.sub,
      }),
    );
  }

  /** 取回最近一次落地的接收 intake（含買斷／訂閱建置分支）。 */
  @Get('cases/:caseId/intake')
  @Permissions('case:read')
  getIntake(@Param('caseId') caseId: string): Promise<EnvironmentIntake | null> {
    return guardEngine(() => this.environment.getIntake(caseId));
  }

  /** 記錄買斷制主機採購狀態（§6.3：未採購→案件 ON_HOLD；已採購→IN_PROGRESS）。 */
  @Post('cases/:caseId/host-procurement')
  @Permissions('case:update')
  recordHostProcurement(
    @CurrentUser() user: SessionUser,
    @Param('caseId') caseId: string,
    @Body() body: { procured?: boolean; note?: string },
  ): Promise<HostReadiness> {
    if (typeof body?.procured !== 'boolean') {
      throw new BadRequestException({ code: 'procured_required', message: 'procured（true/false）必填' });
    }
    return guardEngine(() =>
      this.environment.recordHostProcurement({
        environmentCaseId: caseId,
        procured: body.procured as boolean,
        note: body?.note,
        recordedById: user.sub,
      }),
    );
  }

  /** 主機就緒判斷（買斷需已採購；訂閱恆可建置；§6.1／§6.3）。 */
  @Get('cases/:caseId/host-readiness')
  @Permissions('case:read')
  getHostReadiness(@Param('caseId') caseId: string): Promise<HostReadiness> {
    return guardEngine(() => this.environment.getHostReadiness(caseId));
  }

  /** 提交環境建置表單（建置檢核表／租戶開立紀錄／驗收表等，append-only；§6.2 步驟2/3）。 */
  @Post('cases/:caseId/forms/:formCode')
  @Permissions('form:fill')
  submitForm(
    @CurrentUser() user: SessionUser,
    @Param('caseId') caseId: string,
    @Param('formCode') formCode: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ submissionId: string }> {
    return guardEngine(() => this.environment.submitEnvironmentForm(caseId, formCode, body ?? {}, user.sub));
  }

  /** 各表單代碼之最新狀態投影（供驗收齊備把關檢視）。 */
  @Get('cases/:caseId/form-statuses')
  @Permissions('form:read')
  getFormStatuses(@Param('caseId') caseId: string): Promise<FormStatusLike[]> {
    return guardEngine(() => this.environment.getFormStatuses(caseId));
  }

  /** 環境驗收完成（§6.2 步驟3）：把關通過後案件 →COMPLETED（環境就緒）。 */
  @Post('cases/:caseId/complete')
  @Permissions('case:advance')
  complete(
    @Param('caseId') caseId: string,
  ): Promise<{ environmentCaseId: string; result: EnvironmentAcceptanceResult }> {
    return guardEngine(() => this.environment.completeEnvironment({ environmentCaseId: caseId }));
  }

  /**
   * 計算環境建置排程（純計算；DB 假日＋專案排除日遞延）。
   * §6 未內建預設時間點位移（§12 待釐清），checkpoints 由呼叫端提供、不臆測。
   */
  @Post('schedule')
  @Permissions('case:read')
  buildSchedule(
    @Body()
    body: {
      anchor?: string;
      checkpoints?: OnboardingCheckpointDef<EnvironmentStep>[];
      projectId?: string;
      custom?: HolidayCalendarInput;
    },
  ): Promise<ScheduledCheckpoint<EnvironmentStep>[]> {
    if (body?.anchor == null || body.anchor === '') {
      throw new BadRequestException({ code: 'invalid_body', message: 'anchor 必填（ISO 日期）' });
    }
    const anchor = new Date(body.anchor);
    if (Number.isNaN(anchor.getTime())) {
      throw new BadRequestException({ code: 'invalid_body', message: `anchor 不是合法日期：${body.anchor}` });
    }
    return guardEngine(() =>
      this.environment.buildEnvironmentSchedule(anchor, body?.checkpoints ?? [], {
        projectId: body?.projectId,
        custom: body?.custom,
      }),
    );
  }
}
