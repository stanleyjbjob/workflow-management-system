import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SessionUser } from '../auth/auth.service';
import { hasAllPermissions, Permission } from './permissions';
import { PERMISSIONS_KEY } from './rbac.constants';

/**
 * 權限 Guard：比對 @Permissions(...) 標註與使用者角色展開後的權限集合（需全部具備）。
 * 須排在 SessionAuthGuard 之後（依賴其掛上的 request.user）。
 * 未標註 @Permissions 視為不限制（放行）。
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<{ user?: SessionUser }>();
    const user = req.user;
    if (!user) throw new UnauthorizedException('unauthenticated');
    if (!hasAllPermissions(user.roles, required)) {
      throw new ForbiddenException('insufficient_permission');
    }
    return true;
  }
}
