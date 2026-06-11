import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CaseAccessModule } from '../common/case-access.module';
import { RbacModule } from '../rbac/rbac.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';

/**
 * 附件與連結管理模組（2.5；REST 於 8.8 #43 補齊）：提供 AttachmentsService 與通用附件 REST。
 * - 任務／步驟／表單可掛載附件（檔案／連結）、下載、版本控管與版本歷史追溯。
 * - SharePoint / OneDrive 連結沿用 Microsoft 365 既有雲端權限。
 * - REST：GET/POST /attachments、GET /attachments/download、GET /attachments/history
 *   （目標以 caseId / stepInstanceId / formSubmissionId 三擇一指定）。
 * PrismaModule 為全域模組，已提供 PrismaService，故此處毋須再匯入。
 */
@Module({
  imports: [AuthModule, RbacModule, CaseAccessModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
