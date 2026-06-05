import { SetMetadata } from '@nestjs/common';
import { PERMISSIONS_KEY } from './rbac.constants';
import { Permission } from './permissions';

/**
 * 標註端點所需權限（需全部具備）。需搭配 PermissionsGuard 與已驗證登入的 request.user。
 *
 * 範例：`@UseGuards(SessionAuthGuard, PermissionsGuard) @Permissions('case:assign')`
 */
export const Permissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
