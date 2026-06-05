import { Injectable } from '@nestjs/common';

/**
 * 由環境變數讀取 Entra ID / session 設定。
 * 地端買斷與雲端訂閱租戶皆以環境變數注入各自的 tenant / client 設定。
 */
@Injectable()
export class AuthConfigService {
  readonly tenantId = process.env.ENTRA_TENANT_ID ?? '';
  readonly clientId = process.env.ENTRA_CLIENT_ID ?? '';
  readonly clientSecret = process.env.ENTRA_CLIENT_SECRET ?? '';
  readonly redirectUri =
    process.env.ENTRA_REDIRECT_URI ?? 'http://localhost:3000/auth/callback';
  readonly scopes = (process.env.ENTRA_SCOPES ?? 'openid profile email User.Read').split(/\s+/).filter(Boolean);
  readonly sessionSecret = process.env.AUTH_SESSION_SECRET ?? 'dev-insecure-secret-change-me';
  readonly sessionTtlSeconds = Number(process.env.AUTH_SESSION_TTL ?? 28800);
  readonly postLoginRedirect =
    process.env.AUTH_POST_LOGIN_REDIRECT ?? process.env.WEB_BASE_URL ?? 'http://localhost:5173';
  readonly cookieSecure = process.env.NODE_ENV === 'production';

  get authority(): string {
    return `https://login.microsoftonline.com/${this.tenantId}`;
  }

  /** 是否已具備可進行 SSO 的必要設定。 */
  get isConfigured(): boolean {
    return Boolean(this.tenantId && this.clientId && this.clientSecret);
  }
}
