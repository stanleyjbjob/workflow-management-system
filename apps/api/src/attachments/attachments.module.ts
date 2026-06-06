import { Module } from '@nestjs/common';
import { AttachmentsService } from './attachments.service';

/**
 * 附件與連結管理模組（2.5）：提供 AttachmentsService。
 * - 任務／步驟／表單可掛載附件（檔案／連結）、下載、版本控管與版本歷史追溯。
 * - SharePoint / OneDrive 連結沿用 Microsoft 365 既有雲端權限。
 * PrismaModule 為全域模組，已提供 PrismaService，故此處毋須再匯入。
 */
@Module({
  providers: [AttachmentsService],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
