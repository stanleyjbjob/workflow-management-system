import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthConfigService } from './auth.config';
import { SESSION_COOKIE } from './auth.constants';
import { parseCookies } from './cookie.util';
import { SessionUser } from './auth.service';
import { verifyToken } from './token.util';

/**
 * 驗證 session cookie 並將使用者掛到 request.user。供需要登入的端點使用。
 * （細緻的角色授權於 1.4 RBAC 實作。）
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly config: AuthConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | string[] | undefined>; user?: SessionUser }>();
    const cookieHeader = req.headers.cookie;
    const cookies = parseCookies(Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader);
    const token = cookies[SESSION_COOKIE];
    const payload = token ? verifyToken<SessionUser>(token, this.config.sessionSecret) : null;
    if (!payload) {
      throw new UnauthorizedException('unauthenticated');
    }
    req.user = payload;
    return true;
  }
}
