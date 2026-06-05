import { SetMetadata } from '@nestjs/common';
import { RoleCode } from '@prisma/client';
import { ROLES_KEY } from './rbac.constants';

/**
 * 標註端點所需角色（具備任一即放行）。需搭配 RolesGuard 與已驗證登入的 request.user。
 *
 * 範例：`@UseGuards(SessionAuthGuard, RolesGuard) @Roles('MANAGER', 'ENG_LEAD')`
 */
export const Roles = (...roles: RoleCode[]) => SetMetadata(ROLES_KEY, roles);
