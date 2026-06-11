import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module';
import { CaseAccessService } from './case-access.service';

/**
 * 案件可見性共用模組（issue 8.8 #43）：提供 CaseAccessService 給
 * forms / attachments 等通用 REST 模組共用。PrismaModule 為全域模組毋須匯入。
 */
@Module({
  imports: [RbacModule],
  providers: [CaseAccessService],
  exports: [CaseAccessService],
})
export class CaseAccessModule {}
