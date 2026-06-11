import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RbacModule } from '../rbac/rbac.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';

/**
 * 案件統一查詢/詳情/推進模組（issue 8.7 #42）。
 * 依賴：PrismaModule（資料）、RbacModule（AccessScope + PermissionsGuard）、
 * AuthModule（SessionAuthGuard）、WorkflowModule（advance/return 引擎編排）。
 */
@Module({
  imports: [PrismaModule, RbacModule, AuthModule, WorkflowModule],
  controllers: [CasesController],
  providers: [CasesService],
  exports: [CasesService],
})
export class CasesModule {}
