import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StepTemplate } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DownloadTarget,
  EngineStepTemplate,
  TemplateInput,
  TemplatesEngineError,
  distinctTemplateNames,
  latestTemplates,
  planCreateTemplate,
  resolveDownload,
  templateHistory,
} from './templates-engine';

/** 上傳／掛載作業範本（或新版本）的輸入。 */
export interface AttachTemplateInput {
  name: string;
  /** 檔案附件 URL（與 linkUrl 二擇一）。 */
  fileUrl?: string | null;
  /** 外部連結 URL，如 SharePoint / OneDrive（與 fileUrl 二擇一）。 */
  linkUrl?: string | null;
  fileType?: string | null;
}

function toEngine(t: StepTemplate): EngineStepTemplate {
  return {
    id: t.id,
    stepId: t.stepId,
    name: t.name,
    fileUrl: t.fileUrl,
    linkUrl: t.linkUrl,
    fileType: t.fileType,
    version: t.version,
    createdAt: t.createdAt,
  };
}

/**
 * 作業範本附檔服務（2.4）。
 *
 * 對應需求規格 §8.1：
 * - 步驟可附加作業範本檔（表單範本、檢核表、SOP），承辦可下載（attachTemplate / getStepTemplates / getDownloadTarget）。
 * - 範本具版本控管、可追溯（每次同名上傳累加版本；getTemplateHistory 提供完整版本歷史）。
 *
 * 設計決策：所有「決策／驗證／版本計算」邏輯都委派給純核心 templates-engine（可純函式單元測試），
 * 本服務只負責讀寫資料庫並把引擎錯誤轉為對應 HTTP 例外（與 FormsService / WorkflowService 一致）。
 */
@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  /** 將引擎錯誤轉為 400；其餘照原樣丟出。 */
  private run<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof TemplatesEngineError) {
        if (e.code === 'template_not_found') throw new NotFoundException(e.code);
        throw new BadRequestException(e.code);
      }
      throw e;
    }
  }

  private async loadStepTemplates(stepId: string): Promise<StepTemplate[]> {
    return this.prisma.stepTemplate.findMany({ where: { stepId } });
  }

  /**
   * 上傳／掛載一份作業範本到步驟。
   * 若該步驟已有同名範本，視為「新版本」並自動累加版本號。
   */
  async attachTemplate(
    stepId: string,
    input: AttachTemplateInput,
  ): Promise<StepTemplate> {
    const existing = (await this.loadStepTemplates(stepId)).map(toEngine);
    const engineInput: TemplateInput = {
      stepId,
      name: input.name,
      fileUrl: input.fileUrl,
      linkUrl: input.linkUrl,
      fileType: input.fileType,
    };
    const plan = this.run(() => planCreateTemplate(existing, engineInput));

    return this.prisma.stepTemplate.create({
      data: {
        stepId: plan.stepId,
        name: plan.name,
        fileUrl: plan.fileUrl,
        linkUrl: plan.linkUrl,
        fileType: plan.fileType,
        version: plan.version,
      },
    });
  }

  /**
   * 取得某步驟「目前可下載」的範本清單（每個名稱只取最新版），供案件承辦下載。
   */
  async getStepTemplates(stepId: string): Promise<EngineStepTemplate[]> {
    const all = (await this.loadStepTemplates(stepId)).map(toEngine);
    return latestTemplates(all);
  }

  /** 取得某步驟某範本的完整版本歷史（由新到舊，可追溯）。 */
  async getTemplateHistory(
    stepId: string,
    name: string,
  ): Promise<EngineStepTemplate[]> {
    const all = (await this.loadStepTemplates(stepId)).map(toEngine);
    return templateHistory(all, name);
  }

  /** 列出某步驟所有不重複的範本名稱。 */
  async getTemplateNames(stepId: string): Promise<string[]> {
    const all = (await this.loadStepTemplates(stepId)).map(toEngine);
    return distinctTemplateNames(all);
  }

  /**
   * 解析某步驟某範本目前可下載的最新版本（含可追溯來源與下載 URL）。
   * 找不到時丟出 404。
   */
  async getDownloadTarget(stepId: string, name: string): Promise<DownloadTarget> {
    const all = (await this.loadStepTemplates(stepId)).map(toEngine);
    return this.run(() => resolveDownload(all, name));
  }

  /** 依範本 id 取得單一版本（供直接下載特定版本）。 */
  async getTemplateById(id: string): Promise<StepTemplate> {
    const t = await this.prisma.stepTemplate.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('template_not_found');
    return t;
  }
}
