import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SessionUser } from '../auth/auth.service';
import { hasAnyRole } from './permissions';
import { ROLES_KEY } from './rbac.constants';

/**
 * 角色 Guard：比對 @Roles(...) 標註與 request.user.roles。
 * 須排在 SessionAuthGuard 之後（依賴其掛上的 request.user）。
 * 未標註 @Roles 視為不限制角色（放行，交由其他 Guard/權限把關）。
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<{ user?: SessionUser }>();
    const user = req.user;
    if (!user) throw new UnauthorizedException('unauthenticated');
    if (!hasAnyRole(user.roles, required)) {
      throw new ForbiddenException('insufficient_role');
    }
    return true;
  }
}
