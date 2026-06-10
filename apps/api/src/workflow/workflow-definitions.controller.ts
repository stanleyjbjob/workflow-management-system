import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SessionUser } from '../auth/auth.service';
import { guardEngine } from '../common/engine-http';
import { Permissions } from '../rbac/permissions.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import {
  DeleteResultDto,
  WorkflowDefinitionsService,
  WorkflowDraftDto,
  WorkflowSummaryDto,
} from './workflow-definitions.service';

/**
 * 流程定義 CRUD REST（issue 8.6 #41 / 需求 §3）。
 *
 * 沿用 KanbanController / SalesController 風格：
 * @UseGuards(SessionAuthGuard, PermissionsGuard) + @Permissions + @CurrentUser；
 * 業務錯誤（snake_case code）經 guardEngine 轉 400 {code,message}。
 *
 * 權限：查詢 `workflow:read`；建立／修改／刪除 `workflow:manage`（MANAGER）。
 *
 * 路由一覽（對齊設計器 WorkflowRepository 介面，便於 #46 直接替換 localStorage）：
 * - GET    /workflows         列表摘要（WorkflowSummary[]）
 * - POST   /workflows         建立（body = WorkflowDraft；回正規化後草稿）
 * - GET    /workflows/:id     取得完整草稿（WorkflowDraft）
 * - PATCH  /workflows/:id     全量儲存草稿（步驟全量替換；回正規化後草稿）
 * - DELETE /workflows/:id     刪除；已被案件引用時改停用（軟刪保護）
 */
@Controller('workflows')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class WorkflowDefinitionsController {
  constructor(private readonly definitions: WorkflowDefinitionsService) {}

  @Get()
  @Permissions('workflow:read')
  list(): Promise<WorkflowSummaryDto[]> {
    return guardEngine(() => this.definitions.list());
  }

  @Get(':id')
  @Permissions('workflow:read')
  get(@Param('id') id: string): Promise<WorkflowDraftDto> {
    return guardEngine(() => this.definitions.get(id));
  }

  @Post()
  @Permissions('workflow:manage')
  create(
    @CurrentUser() user: SessionUser,
    @Body() body: WorkflowDraftDto,
  ): Promise<WorkflowDraftDto> {
    return guardEngine(() => this.definitions.create(body, user.sub));
  }

  @Patch(':id')
  @Permissions('workflow:manage')
  update(
    @Param('id') id: string,
    @Body() body: WorkflowDraftDto,
  ): Promise<WorkflowDraftDto> {
    return guardEngine(() => this.definitions.update(id, body));
  }

  @Delete(':id')
  @Permissions('workflow:manage')
  remove(@Param('id') id: string): Promise<DeleteResultDto> {
    return guardEngine(() => this.definitions.remove(id));
  }
}
