import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SessionUser } from '../auth/auth.service';
import { guardEngine } from '../common/engine-http';
import { Permissions } from '../rbac/permissions.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { CaseStateView } from '../workflow/workflow.service';
import {
  CaseDetailDto,
  CaseSummaryDto,
  CasesService,
} from './cases.service';

/** POST /cases/:id/advance 的 body。 */
export interface AdvanceCaseBodyDto {
  note?: string | null;
  assigneeId?: string | null;
}

/** POST /cases/:id/return 的 body。 */
export interface ReturnCaseBodyDto {
  targetStepDefinitionId?: string;
  reason?: string;
  assigneeId?: string | null;
}

/**
 * 案件統一查詢/詳情/推進 REST（issue 8.7 #42 / docs B2）。
 *
 * 沿用 KanbanController / WorkflowDefinitionsController 風格：
 * @UseGuards(SessionAuthGuard, PermissionsGuard) + @Permissions + @CurrentUser；
 * 業務錯誤（snake_case code）經 guardEngine 轉 400 {code,message}。
 *
 * 權限：查詢 `case:read`；推進/退回 `case:advance`。
 * 可見範圍：清單以 AccessScopeService.caseWhere 收斂；
 * 詳情/推進/退回以 assertCanViewCase 斷言（不可見 → 403 case_not_visible）。
 *
 * 路由一覽：
 * - GET  /cases?flowType=&status=&assigneeId=   案件清單（摘要）
 * - GET  /cases/:id/detail                      案件詳情彙整視圖
 * - POST /cases/:id/advance                     通用推進（包 WorkflowService.advanceCase）
 * - POST /cases/:id/return                      通用退回（包 WorkflowService.returnCase）
 * 四大流程的專屬動作（如成案/失敗結案）仍走各自 controller。
 */
@Controller('cases')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  @Get()
  @Permissions('case:read')
  list(
    @CurrentUser() user: SessionUser,
    @Query('flowType') flowType?: string,
    @Query('status') status?: string,
    @Query('assigneeId') assigneeId?: string,
  ): Promise<CaseSummaryDto[]> {
    return guardEngine(() => this.cases.list(user, { flowType, status, assigneeId }));
  }

  @Get(':id/detail')
  @Permissions('case:read')
  detail(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
  ): Promise<CaseDetailDto> {
    return guardEngine(() => this.cases.detail(user, id));
  }

  @Post(':id/advance')
  @Permissions('case:advance')
  advance(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body() body?: AdvanceCaseBodyDto,
  ): Promise<CaseStateView> {
    return guardEngine(() =>
      this.cases.advance(user, id, {
        note: body?.note ?? null,
        ...(body?.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
      }),
    );
  }

  @Post(':id/return')
  @Permissions('case:advance')
  return(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body() body?: ReturnCaseBodyDto,
  ): Promise<CaseStateView> {
    return guardEngine(() =>
      this.cases.return(user, id, body?.targetStepDefinitionId, {
        reason: body?.reason,
        ...(body?.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
      }),
    );
  }
}
