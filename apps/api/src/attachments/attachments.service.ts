import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Attachment } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AttachmentInput,
  AttachmentTarget,
  AttachmentsEngineError,
  DownloadTarget,
  EngineAttachment,
  attachmentHistory,
  distinctAttachmentNames,
  latestAttachments,
  planCreateAttachment,
  resolveDownload,
  resolveTarget,
} from './attachments-engine';

/** 上傳／掛載附件（或新版本）的輸入。 */
export interface AddAttachmentInput {
  name: string;
  /** 檔案附件 URL（與 linkUrl 二擇一）。 */
  fileUrl?: string | null;
  /** 外部連結 URL，如 SharePoint / OneDrive（與 fileUrl 二擇一）。 */
  linkUrl?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  /** 上傳者使用者 id（記錄上傳者）。 */
  uploadedById?: string | null;
}

function toEngine(a: Attachment): EngineAttachment {
  return {
    id: a.id,
    name: a.name,
    type: a.type as EngineAttachment['type'],
    fileUrl: a.fileUrl,
    linkUrl: a.linkUrl,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    version: a.version,
    uploadedById: a.uploadedById,
    caseId: a.caseId,
    stepInstanceId: a.stepInstanceId,
    formSubmissionId: a.formSubmissionId,
    createdAt: a.createdAt,
  };
}

/**
 * 附件與連結管理服務（2.5）。
 *
 * 對應需求規格 §8.6：
 * - 任務／步驟／表單可加掛附件：上傳檔案（存於系統並與目標綁定）或外部連結（addAttachment）。
 * - 連結優先支援 SharePoint / OneDrive，沿用 Microsoft 365 既有雲端權限（引擎判定 permissionModel）。
 * - 記錄上傳者、時間（createdAt）、版本（同名再上傳累加），永久留存可調閱、版本歷史可追溯。
 *
 * 設計決策：所有「決策／驗證／版本計算／權限模型判定」邏輯都委派給純核心 attachments-engine
 * （可純函式單元測試），本服務只負責讀寫資料庫並把引擎錯誤轉為對應 HTTP 例外
 * （與 TemplatesService / FormsService 一致）。
 */
@Injectable()
export class AttachmentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 將引擎錯誤轉為 400／404；其餘照原樣丟出。 */
  private run<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof AttachmentsEngineError) {
        if (e.code === 'attachment_not_found') throw new NotFoundException(e.code);
        throw new BadRequestException(e.code);
      }
      throw e;
    }
  }

  /** 載入某目標既有的所有附件（依目標欄位精準過濾）。 */
  private async loadTargetAttachments(
    target: AttachmentTarget,
  ): Promise<Attachment[]> {
    const resolved = this.run(() => resolveTarget(target));
    const where =
      resolved.kind === 'CASE'
        ? { caseId: resolved.id }
        : resolved.kind === 'STEP_INSTANCE'
          ? { stepInstanceId: resolved.id }
          : { formSubmissionId: resolved.id };
    return this.prisma.attachment.findMany({ where });
  }

  /**
   * 上傳／掛載一份附件到目標（案件／步驟實例／表單提交三者擇一）。
   * 若該目標已有同名附件，視為「新版本」並自動累加版本號。
   */
  async addAttachment(
    target: AttachmentTarget,
    input: AddAttachmentInput,
  ): Promise<Attachment> {
    const existing = (await this.loadTargetAttachments(target)).map(toEngine);
    const engineInput: AttachmentInput = {
      ...target,
      name: input.name,
      fileUrl: input.fileUrl,
      linkUrl: input.linkUrl,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      uploadedById: input.uploadedById,
    };
    const plan = this.run(() => planCreateAttachment(existing, engineInput));

    return this.prisma.attachment.create({
      data: {
        type: plan.type,
        name: plan.name,
        fileUrl: plan.fileUrl,
        linkUrl: plan.linkUrl,
        mimeType: plan.mimeType,
        sizeBytes: plan.sizeBytes,
        version: plan.version,
        uploadedById: plan.uploadedById,
        caseId: plan.kind === 'CASE' ? plan.id : null,
        stepInstanceId: plan.kind === 'STEP_INSTANCE' ? plan.id : null,
        formSubmissionId: plan.kind === 'FORM_SUBMISSION' ? plan.id : null,
      },
    });
  }

  /** 取得某目標「目前可下載」的附件清單（每個名稱只取最新版）。 */
  async listAttachments(target: AttachmentTarget): Promise<EngineAttachment[]> {
    const all = (await this.loadTargetAttachments(target)).map(toEngine);
    return latestAttachments(all);
  }

  /** 取得某目標某附件的完整版本歷史（由新到舊，可追溯）。 */
  async getAttachmentHistory(
    target: AttachmentTarget,
    name: string,
  ): Promise<EngineAttachment[]> {
    const all = (await this.loadTargetAttachments(target)).map(toEngine);
    return attachmentHistory(all, name);
  }

  /** 列出某目標所有不重複的附件名稱。 */
  async getAttachmentNames(target: AttachmentTarget): Promise<string[]> {
    const all = (await this.loadTargetAttachments(target)).map(toEngine);
    return distinctAttachmentNames(all);
  }

  /**
   * 解析某目標某附件目前可下載的最新版本（含可追溯來源、權限模型與上傳者/時間）。
   * 找不到時丟出 404。
   */
  async getDownloadTarget(
    target: AttachmentTarget,
    name: string,
  ): Promise<DownloadTarget> {
    const all = (await this.loadTargetAttachments(target)).map(toEngine);
    return this.run(() => resolveDownload(all, name));
  }

  /** 依附件 id 取得單一版本（供直接下載特定版本）。 */
  async getAttachmentById(id: string): Promise<Attachment> {
    const a = await this.prisma.attachment.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('attachment_not_found');
    return a;
  }
}
