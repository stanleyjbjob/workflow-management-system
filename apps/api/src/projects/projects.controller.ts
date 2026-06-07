import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProjectStatus } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SessionUser } from '../auth/auth.service';
import { Permissions } from '../rbac/permissions.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { ProjectService } from './project.service';
import { GanttService } from './gantt.service';
import { DelayService, GetProjectDelaysOptions, ProjectDelayReport } from './delay.service';
import { ExclusionService } from './exclusion.service';
import { FlowMountInput, ProjectDraftInput } from './project-engine';
import { ExclusionDraftInput } from './exclusion-engine';
import { GanttView } from './gantt-engine';
import { DayBasis } from './delay-engine';

/**
 * 專案管理 REST 端點（issue 8.1 #33 / 專案管理模組規格 §3、§5、§10）。
 *
 * 沿用 KanbanController 風格：@UseGuards(SessionAuthGuard, PermissionsGuard) + @Permissions + @CurrentUser；
 * 與既有 Service 方法一一對應（ProjectService / GanttService / DelayService / ExclusionService），
 * DTO 驗證沿用各引擎之 guard()→BadRequestException（保留 code 供前端判讀）慣例。
 *
 * 權限對應（RBAC 既有矩陣 permissions.ts）：
 * - 查詢類（清單/詳情/甘特/延遲/排除日/衝突）→ `project:read`。
 * - 建立專案 → `project:create`；編輯/狀態/掛載流程/排除日維護 → `project:update`。
 * - 刪除專案（連帶刪除掛載與排除日）→ `project:manage`（主管層級操作）。
 *
 * 路由一覽：
 * - GET    /projects?status=&ownerId=                 專案清單
 * - POST   /projects                                  建立專案（createdById＝目前登入者）
 * - GET    /projects/:id                              專案（含 flows / exclusions / owner）
 * - GET    /projects/:id/detail                       專案詳情（向下展開步驟與負責人）
 * - PATCH  /projects/:id                              編輯專案（部分更新）
 * - PATCH  /projects/:id/status                       變更狀態（狀態機把關）
 * - DELETE /projects/:id                              刪除專案
 * - POST   /projects/:id/flows                        掛載流程（案件）
 * - PATCH  /projects/flows/:projectFlowId             調整掛載視窗 / 進度
 * - DELETE /projects/flows/:projectFlowId             移除掛載（不刪案件）
 * - POST   /projects/flows/:projectFlowId/refresh-progress  依案件步驟比例回寫進度
 * - GET    /projects/:id/gantt?fresh=&now=&toleranceThreshold=   甘特圖（§5.2）
 * - GET    /projects/:id/delays?fresh=&now=&basis=&threshold=    延遲/超前清單（§4.2–§4.4）
 * - GET    /projects/:id/exclusions                   排除日清單（§10.5）
 * - POST   /projects/:id/exclusions                   新增排除日
 * - PATCH  /projects/exclusions/:exclusionId          編輯排除日
 * - DELETE /projects/exclusions/:exclusionId          移除排除日
 * - GET    /projects/:id/exclusion-conflicts?includeAllFlows=    排除日×流程區間衝突警示（§9-6 A 案）
 */
@Controller('projects')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class ProjectsController {
  constructor(
    private readonly projects: ProjectService,
    private readonly gantt: GanttService,
    private readonly delays: DelayService,
    private readonly exclusions: ExclusionService,
  ) {}

  // ---- query 解析（非法輸入一律 400 + code，與引擎錯誤慣例一致）----

  private parseDateQuery(value: string | undefined, field: string): Date | undefined {
    if (value == null || value === '') return undefined;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException({ code: 'invalid_query', message: `${field} 不是合法日期：${value}` });
    }
    return d;
  }

  private parseNumberQuery(value: string | undefined, field: string): number | undefined {
    if (value == null || value === '') return undefined;
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw new BadRequestException({ code: 'invalid_query', message: `${field} 不是合法數值：${value}` });
    }
    return n;
  }

  private parseStatus(value: string): ProjectStatus {
    const all = Object.values(ProjectStatus) as string[];
    if (!all.includes(value)) {
      throw new BadRequestException({ code: 'invalid_query', message: `status 必須為 ${all.join(' / ')}：${value}` });
    }
    return value as ProjectStatus;
  }

  private static isTruthyFlag(value: string | undefined): boolean {
    return value === 'true' || value === '1';
  }

  // ---- 掛載流程（literal 路徑段，先於 :id 宣告以免被參數路由攔截）----

  /** 調整掛載流程的計畫起迄 / 進度（§3.2）。 */
  @Patch('flows/:projectFlowId')
  @Permissions('project:update')
  updateFlowWindow(
    @Param('projectFlowId') projectFlowId: string,
    @Body() body: { planStart?: Date | string; planEnd?: Date | string; progress?: number },
  ): Promise<{ id: string }> {
    return this.projects.updateFlowWindow(projectFlowId, body ?? {});
  }

  /** 移除流程掛載（不刪除案件本身）。 */
  @Delete('flows/:projectFlowId')
  @Permissions('project:update')
  unmountFlow(@Param('projectFlowId') projectFlowId: string): Promise<{ id: string }> {
    return this.projects.unmountFlow(projectFlowId);
  }

  /** 依案件步驟完成比例回寫 ProjectFlow.progress（§4.1 預設認定）。 */
  @Post('flows/:projectFlowId/refresh-progress')
  @Permissions('project:update')
  refreshFlowProgress(@Param('projectFlowId') projectFlowId: string): Promise<{ id: string; progress: number }> {
    return this.projects.refreshFlowProgress(projectFlowId);
  }

  // ---- 排除日（literal 路徑段）----

  /** 編輯排除日（部分更新；未提供欄位沿用現值）。 */
  @Patch('exclusions/:exclusionId')
  @Permissions('project:update')
  updateExclusion(
    @Param('exclusionId') exclusionId: string,
    @Body() body: ExclusionDraftInput,
  ): Promise<{ id: string }> {
    return this.exclusions.updateExclusion(exclusionId, body ?? {});
  }

  /** 移除排除日。 */
  @Delete('exclusions/:exclusionId')
  @Permissions('project:update')
  removeExclusion(@Param('exclusionId') exclusionId: string): Promise<{ id: string }> {
    return this.exclusions.removeExclusion(exclusionId);
  }

  // ---- 專案 CRUD ----

  /** 專案清單（可選 status / ownerId 過濾）。 */
  @Get()
  @Permissions('project:read')
  list(@Query('status') status?: string, @Query('ownerId') ownerId?: string): Promise<unknown[]> {
    return this.projects.listProjects({
      status: status ? this.parseStatus(status) : undefined,
      ownerId: ownerId && ownerId.length > 0 ? ownerId : undefined,
    });
  }

  /** 建立專案（§6.1 步驟1；createdById＝目前登入者）。 */
  @Post()
  @Permissions('project:create')
  create(
    @CurrentUser() user: SessionUser,
    @Body() body: ProjectDraftInput,
  ): Promise<{ id: string; code: string }> {
    return this.projects.createProject({ ...(body ?? {}), createdById: user.sub });
  }

  /** 專案詳情：每個流程向下展開其案件步驟與負責人（§5.1 向下查看）。 */
  @Get(':id/detail')
  @Permissions('project:read')
  detail(@Param('id') id: string): Promise<unknown> {
    return this.projects.getProjectDetail(id);
  }

  /** 甘特圖（§5.2；fresh=true 先依案件步驟比例回寫各流程進度）。 */
  @Get(':id/gantt')
  @Permissions('project:read')
  getGantt(
    @Param('id') id: string,
    @Query('fresh') fresh?: string,
    @Query('now') now?: string,
    @Query('toleranceThreshold') toleranceThreshold?: string,
  ): Promise<GanttView> {
    const options = {
      now: this.parseDateQuery(now, 'now'),
      toleranceThreshold: this.parseNumberQuery(toleranceThreshold, 'toleranceThreshold'),
    };
    return ProjectsController.isTruthyFlag(fresh)
      ? this.gantt.getProjectGanttFresh(id, options)
      : this.gantt.getProjectGantt(id, options);
  }

  /** 延遲／超前清單（§4.2–§4.4；basis=CALENDAR|WORKDAY、threshold 覆寫容許門檻 T）。 */
  @Get(':id/delays')
  @Permissions('project:read')
  getDelays(
    @Param('id') id: string,
    @Query('fresh') fresh?: string,
    @Query('now') now?: string,
    @Query('basis') basis?: string,
    @Query('threshold') threshold?: string,
  ): Promise<ProjectDelayReport> {
    let basisValue: DayBasis | undefined;
    if (basis != null && basis !== '') {
      if (basis !== 'CALENDAR' && basis !== 'WORKDAY') {
        throw new BadRequestException({ code: 'invalid_query', message: `basis 必須為 CALENDAR / WORKDAY：${basis}` });
      }
      basisValue = basis;
    }
    const options: GetProjectDelaysOptions = {
      now: this.parseDateQuery(now, 'now'),
      basis: basisValue,
      thresholds: this.parseNumberQuery(threshold, 'threshold'),
    };
    return ProjectsController.isTruthyFlag(fresh)
      ? this.delays.getProjectDelaysFresh(id, options)
      : this.delays.getProjectDelays(id, options);
  }

  /** 排除日清單（§10.5）。 */
  @Get(':id/exclusions')
  @Permissions('project:read')
  listExclusions(@Param('id') id: string): Promise<unknown[]> {
    return this.exclusions.listExclusions(id);
  }

  /** 新增排除日（起、迄、原因、來源；§3.3）。 */
  @Post(':id/exclusions')
  @Permissions('project:update')
  addExclusion(@Param('id') id: string, @Body() body: ExclusionDraftInput): Promise<{ id: string }> {
    return this.exclusions.addExclusion(id, body ?? {});
  }

  /** 排除日×流程計畫區間衝突警示（§9-6 A 案：不自動順延，由使用者決定）。 */
  @Get(':id/exclusion-conflicts')
  @Permissions('project:read')
  getExclusionConflicts(
    @Param('id') id: string,
    @Query('includeAllFlows') includeAllFlows?: string,
  ): Promise<unknown[]> {
    return this.exclusions.getExclusionConflicts(id, {
      includeAllFlows: ProjectsController.isTruthyFlag(includeAllFlows),
    });
  }

  /** 變更專案狀態（狀態機把關；§3.1）。 */
  @Patch(':id/status')
  @Permissions('project:update')
  changeStatus(
    @Param('id') id: string,
    @Body() body: { status?: string },
  ): Promise<{ id: string; status: ProjectStatus }> {
    const status = (body?.status ?? '').trim();
    if (!status) {
      throw new BadRequestException({ code: 'status_required', message: 'status 必填' });
    }
    return this.projects.changeStatus(id, this.parseStatus(status));
  }

  /** 掛載流程（案件）至專案並設定計畫起迄（§3.2、§6.1）。 */
  @Post(':id/flows')
  @Permissions('project:update')
  mountFlow(@Param('id') id: string, @Body() body: FlowMountInput): Promise<{ id: string }> {
    return this.projects.mountFlow(id, body ?? {});
  }

  /** 讀取單一專案（含掛載流程、排除日、負責人）。 */
  @Get(':id')
  @Permissions('project:read')
  get(@Param('id') id: string): Promise<unknown> {
    return this.projects.getProject(id);
  }

  /** 編輯專案（名稱／客戶／負責人／計畫起迄，部分更新）。 */
  @Patch(':id')
  @Permissions('project:update')
  update(@Param('id') id: string, @Body() body: ProjectDraftInput): Promise<{ id: string }> {
    return this.projects.updateProject(id, body ?? {});
  }

  /** 刪除專案（連帶刪除掛載與排除日；主管層級操作）。 */
  @Delete(':id')
  @Permissions('project:manage')
  remove(@Param('id') id: string): Promise<{ id: string }> {
    return this.projects.deleteProject(id);
  }
}
