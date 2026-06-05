import { Global, Module } from '@nestjs/common';
import { AccessScopeService } from './access-scope.service';
import { PermissionsGuard } from './permissions.guard';
import { RolesGuard } from './roles.guard';

/**
 * RBAC 模組：提供角色/權限 Guard 與可見範圍服務，全域可用，供後續功能模組直接注入。
 * Reflector 由 Nest 核心提供，Guard 可直接注入。
 */
@Global()
@Module({
  providers: [AccessScopeService, RolesGuard, PermissionsGuard],
  exports: [AccessScopeService, RolesGuard, PermissionsGuard],
})
export class RbacModule {}
