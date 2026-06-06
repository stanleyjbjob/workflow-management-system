import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SessionUser } from '../auth/auth.service';
import { Permissions } from '../rbac/permissions.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { KanbanBoard, KanbanFilter } from './kanban-engine';
import { KanbanService } from './kanban.service';

/**
 * 任務看板 REST 端點（issue 6.1 / §8）。
 * 需登入（SessionAuthGuard）且具 `case:read` 權限（PermissionsGuard）。
 * 可見範圍由 KanbanService 以 AccessScopeService 依角色收斂（§8.5）。
 *
 * GET /kanban?role=&assignee=&flowType=&onlyMine=&upcomingWithinDays=
 *  - role：僅看該角色（RoleCode）負責的任務。
 *  - assignee：僅看指派給該使用者者。
 *  - flowType：僅看該流程型別。
 *  - onlyMine：true/1 僅看與我相關（指派給我或我角色負責）。
 *  - upcomingWithinDays：覆寫「即將到期」視窗（工作日，預設 3）。
 * 回傳之每張卡含 caseId / caseCode，前端據此「點任務卡開啟案件詳情」。
 */
@Controller('kanban')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class KanbanController {
  constructor(private readonly kanban: KanbanService) {}

  @Get()
  @Permissions('case:read')
  getBoard(
    @CurrentUser() user: SessionUser,
    @Query('role') role?: string,
    @Query('assignee') assignee?: string,
    @Query('flowType') flowType?: string,
    @Query('onlyMine') onlyMine?: string,
    @Query('upcomingWithinDays') upcomingWithinDays?: string,
  ): Promise<KanbanBoard> {
    const filter: KanbanFilter = {
      roleCode: role && role.length > 0 ? role : null,
      assigneeId: assignee && assignee.length > 0 ? assignee : null,
      flowType: flowType && flowType.length > 0 ? flowType : null,
      onlyMine: onlyMine === 'true' || onlyMine === '1',
    };
    const n = upcomingWithinDays != null ? Number(upcomingWithinDays) : NaN;
    const options =
      Number.isInteger(n) && n >= 0 ? { upcomingWithinDays: n } : undefined;
    return this.kanban.getBoard(user, filter, options);
  }
}
