import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CaseAccessModule } from '../common/case-access.module';
import { RbacModule } from '../rbac/rbac.module';
import {
  CaseSubmissionsController,
  FormsController,
  StepFormsController,
} from './forms.controller';
import { FormsService } from './forms.service';

/**
 * 表單與產出文件模組（2.3；REST 於 8.8 #43 補齊）：提供 FormsService 與通用表單 REST。
 * - 自訂表單／欄位、掛載步驟、送出與簽核、步驟必填把關、跨步驟產出引用。
 * - REST：POST /forms/submissions（填寫）、POST /forms/submissions/:id/approve|reject（簽核）、
 *   GET /cases/:caseId/submissions、GET /steps/:stepId/forms。
 * PrismaModule 為全域模組，已提供 PrismaService，故此處毋須再匯入。
 */
@Module({
  imports: [AuthModule, RbacModule, CaseAccessModule],
  controllers: [FormsController, CaseSubmissionsController, StepFormsController],
  providers: [FormsService],
  exports: [FormsService],
})
export class FormsModule {}
