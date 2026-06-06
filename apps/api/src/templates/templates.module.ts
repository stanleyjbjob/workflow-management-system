import { Module } from '@nestjs/common';
import { TemplatesService } from './templates.service';

/**
 * 作業範本附檔模組（2.4）：提供 TemplatesService。
 * - 步驟可掛載作業範本（檔案／連結）、承辦下載、版本控管與版本歷史追溯。
 * PrismaModule 為全域模組，已提供 PrismaService，故此處毋須再匯入。
 */
@Module({
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
