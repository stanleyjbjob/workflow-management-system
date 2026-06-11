import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { guardEngine } from '../common/engine-http';
import { Permissions } from '../rbac/permissions.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import {
  DownloadTarget,
  EngineStepTemplate,
} from './templates-engine';
import { TemplatesService } from './templates.service';

/**
 * 作業範本查詢／下載 REST（issue 8.8 #43 / docs B3）。
 *
 * 範本掛在「步驟定義」層級（非案件實例），為承辦執行步驟時的作業依據，
 * 故不做案件可見性把關；以 `attachment:read` 保護（所有業務角色皆具）。
 * 範本「上傳／管理」屬流程設計者職責，UI 尚無對應互動，本輪刻意不開
 * 寫入端點（避免臆測管理介面需求），待流程設計器（8.11）需要時再補。
 */
@Controller('steps')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class StepTemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  /** 取得某步驟「目前可下載」的範本清單（每名稱取最新版）。 */
  @Get(':stepId/templates')
  @Permissions('attachment:read')
  async list(@Param('stepId') stepId: string): Promise<EngineStepTemplate[]> {
    return guardEngine(() => this.templates.getStepTemplates(stepId));
  }

  /** 解析某步驟某範本最新版本的下載資訊（含可追溯來源）。 */
  @Get(':stepId/templates/download')
  @Permissions('attachment:read')
  async download(
    @Param('stepId') stepId: string,
    @Query('name') name?: string,
  ): Promise<DownloadTarget> {
    return guardEngine(() => this.templates.getDownloadTarget(stepId, name ?? ''));
  }

  /** 取得某步驟某範本的完整版本歷史（由新到舊，可追溯）。 */
  @Get(':stepId/templates/history')
  @Permissions('attachment:read')
  async history(
    @Param('stepId') stepId: string,
    @Query('name') name?: string,
  ): Promise<EngineStepTemplate[]> {
    return guardEngine(() => this.templates.getTemplateHistory(stepId, name ?? ''));
  }
}
