import { Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { AuthConfigService } from './auth.config';
import { OAUTH_STATE_COOKIE, SESSION_COOKIE } from './auth.constants';
import { AuthService, SessionUser } from './auth.service';
import { EntraClient } from './entra.client';
import { parseCookies, serializeCookie } from './cookie.util';
import { signToken, verifyToken } from './token.util';
import { SessionAuthGuard } from './session-auth.guard';
import { CurrentUser } from './current-user.decorator';

/** 最小化的 express res/req 介面，避免引入 @types/express。 */
interface ResLike {
  redirect(url: string): void;
  setHeader(name: string, value: string | string[]): void;
  status(code: number): ResLike;
  json(body: unknown): void;
}
interface ReqLike {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}

function headerStr(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function clientIp(req: ReqLike): string | undefined {
  const fwd = headerStr(req.headers['x-forwarded-for']);
  if (fwd) return fwd.split(',')[0].trim();
  return req.ip ?? req.socket?.remoteAddress;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AuthConfigService,
    private readonly entra: EntraClient,
  ) {}

  /** 導向 Entra ID 授權端點。 */
  @Get('login')
  login(@Res() res: ResLike): void {
    if (!this.config.isConfigured) {
      res
        .status(503)
        .json({
          error: 'sso_not_configured',
          message: 'Entra ID 尚未設定（缺 ENTRA_TENANT_ID / ENTRA_CLIENT_ID / ENTRA_CLIENT_SECRET）',
        });
      return;
    }
    const state = randomBytes(32).toString('hex');
    const nonce = randomBytes(32).toString('hex');
    const stateCookie = signToken({ state, nonce }, this.config.sessionSecret, {
      expiresInSeconds: 600,
    });
    res.setHeader(
      'Set-Cookie',
      serializeCookie(OAUTH_STATE_COOKIE, stateCookie, {
        httpOnly: true,
        maxAge: 600,
        sameSite: 'Lax',
        secure: this.config.cookieSecure,
        path: '/',
      }),
    );
    res.redirect(this.entra.buildAuthorizationUrl(state, nonce));
  }

  /** Entra ID 授權回呼。 */
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: ReqLike,
    @Res() res: ResLike,
  ): Promise<void> {
    const cookies = parseCookies(headerStr(req.headers.cookie));
    const stateCookie = cookies[OAUTH_STATE_COOKIE];
    const verified = stateCookie
      ? verifyToken<{ state: string; nonce: string }>(stateCookie, this.config.sessionSecret)
      : null;
    if (!code || !state || !verified || verified.state !== state) {
      res.status(400).json({ error: 'invalid_state' });
      return;
    }
    try {
      const ctx = { ip: clientIp(req), userAgent: headerStr(req.headers['user-agent']) };
      const { token } = await this.auth.handleCallback(code, ctx);
      res.setHeader('Set-Cookie', [
        serializeCookie(OAUTH_STATE_COOKIE, '', { httpOnly: true, maxAge: 0, path: '/' }),
        serializeCookie(SESSION_COOKIE, token, {
          httpOnly: true,
          maxAge: this.config.sessionTtlSeconds,
          sameSite: 'Lax',
          secure: this.config.cookieSecure,
          path: '/',
        }),
      ]);
      res.redirect(this.config.postLoginRedirect);
    } catch (err) {
      res.status(401).json({
        error: 'login_failed',
        message: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  /** 目前登入者資訊。 */
  @UseGuards(SessionAuthGuard)
  @Get('me')
  me(@CurrentUser() user: SessionUser): SessionUser {
    return user;
  }

  /** 登出：清除 session cookie。 */
  @Post('logout')
  logout(@Res() res: ResLike): void {
    res.setHeader(
      'Set-Cookie',
      serializeCookie(SESSION_COOKIE, '', { httpOnly: true, maxAge: 0, path: '/' }),
    );
    res.status(200).json({ ok: true });
  }
}
