import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { StepTemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

/**
 * 作業範本附檔模組（2.4；REST 於 8.8 #43 補齊）：提供 TemplatesService 與範本查詢 REST。
 * - 步驟可掛載作業範本（檔案／連結）、承辦下載、版本控管與版本歷史追溯。
 * - REST：GET /steps/:stepId/templates、GET /steps/:stepId/templates/download、
 *   GET /steps/:stepId/templates/history。
 * PrismaModule 為全域模組，已提供 PrismaService，故此處毋須再匯入。
 */
@Module({
  imports: [AuthModule, RbacModule],
  controllers: [StepTemplatesController],
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
