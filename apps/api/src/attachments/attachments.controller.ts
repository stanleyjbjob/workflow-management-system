import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Attachment } from '@prisma/client';
import { SessionUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { CaseAccessService } from '../common/case-access.service';
import { guardEngine } from '../common/engine-http';
import { Permissions } from '../rbac/permissions.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import {
  AttachmentTarget,
  DownloadTarget,
  EngineAttachment,
} from './attachments-engine';
import { AttachmentsService } from './attachments.service';

/** POST /attachments 的 body：目標（三者擇一）＋附件內容。 */
export interface AddAttachmentBodyDto {
  caseId?: string | null;
  stepInstanceId?: string | null;
  formSubmissionId?: string | null;
  name: string;
  fileUrl?: string | null;
  linkUrl?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
}

function toTarget(input: {
  caseId?: string | null;
  stepInstanceId?: string | null;
  formSubmissionId?: string | null;
}): AttachmentTarget {
  return {
    caseId: input.caseId || null,
    stepInstanceId: input.stepInstanceId || null,
    formSubmissionId: input.formSubmissionId || null,
  };
}

/**
 * 附件與連結通用 REST（issue 8.8 #43 / docs B3）。
 *
 * 目標以 query/body 三擇一指定（caseId / stepInstanceId / formSubmissionId），
 * 與 attachments-engine resolveTarget 慣例一致；多指定或未指定 → 400。
 * 下載端點回傳「下載解析結果」（SharePoint/OneDrive 連結沿用 M365 雲端權限，
 * 引擎判定 permissionModel），不代理檔案串流。
 *
 * 權限：查詢 `attachment:read`、上傳 `attachment:upload`；
 * 另以 CaseAccessService 比照所屬案件可見性把關（403 case_not_visible）。
 */
@Controller('attachments')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class AttachmentsController {
  constructor(
    private readonly attachments: AttachmentsService,
    private readonly caseAccess: CaseAccessService,
  ) {}

  /** 取得某目標「目前可下載」的附件清單（每名稱取最新版）。 */
  @Get()
  @Permissions('attachment:read')
  async list(
    @CurrentUser() user: SessionUser,
    @Query('caseId') caseId?: string,
    @Query('stepInstanceId') stepInstanceId?: string,
    @Query('formSubmissionId') formSubmissionId?: string,
  ): Promise<EngineAttachment[]> {
    const target = toTarget({ caseId, stepInstanceId, formSubmissionId });
    return guardEngine(async () => {
      await this.caseAccess.assertCanViewTarget(user, target);
      return this.attachments.listAttachments(target);
    });
  }

  /** 上傳檔案附件或掛載外部連結（同名自動累加版本；uploadedById＝登入者）。 */
  @Post()
  @Permissions('attachment:upload')
  async add(
    @CurrentUser() user: SessionUser,
    @Body() body: AddAttachmentBodyDto,
  ): Promise<Attachment> {
    const target = toTarget(body ?? {});
    return guardEngine(async () => {
      await this.caseAccess.assertCanViewTarget(user, target);
      return this.attachments.addAttachment(target, {
        name: body.name,
        fileUrl: body.fileUrl,
        linkUrl: body.linkUrl,
        mimeType: body.mimeType,
        sizeBytes: body.sizeBytes,
        uploadedById: user.sub,
      });
    });
  }

  /** 解析某目標某附件最新版本的下載資訊（含權限模型與可追溯來源）。 */
  @Get('download')
  @Permissions('attachment:read')
  async download(
    @CurrentUser() user: SessionUser,
    @Query('name') name?: string,
    @Query('caseId') caseId?: string,
    @Query('stepInstanceId') stepInstanceId?: string,
    @Query('formSubmissionId') formSubmissionId?: string,
  ): Promise<DownloadTarget> {
    const target = toTarget({ caseId, stepInstanceId, formSubmissionId });
    return guardEngine(async () => {
      await this.caseAccess.assertCanViewTarget(user, target);
      return this.attachments.getDownloadTarget(target, name ?? '');
    });
  }

  /** 取得某目標某附件的完整版本歷史（由新到舊，可追溯）。 */
  @Get('history')
  @Permissions('attachment:read')
  async history(
    @CurrentUser() user: SessionUser,
    @Query('name') name?: string,
    @Query('caseId') caseId?: string,
    @Query('stepInstanceId') stepInstanceId?: string,
    @Query('formSubmissionId') formSubmissionId?: string,
  ): Promise<EngineAttachment[]> {
    const target = toTarget({ caseId, stepInstanceId, formSubmissionId });
    return guardEngine(async () => {
      await this.caseAccess.assertCanViewTarget(user, target);
      return this.attachments.getAttachmentHistory(target, name ?? '');
    });
  }
}
