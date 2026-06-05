import { Injectable } from '@nestjs/common';
import { AuthConfigService } from './auth.config';

export interface EntraTokenResponse {
  access_token: string;
  id_token?: string;
  expires_in?: number;
}

export interface EntraProfile {
  oid: string;
  email: string;
  displayName: string;
}

/**
 * 封裝對 Entra ID / Microsoft Graph 的 HTTP 互動。
 * 使用 Node 20 內建 global fetch，無需額外 HTTP 套件；亦便於在測試中以 mock 取代。
 */
@Injectable()
export class EntraClient {
  constructor(private readonly config: AuthConfigService) {}

  buildAuthorizationUrl(state: string, nonce: string): string {
    const p = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: this.config.redirectUri,
      response_mode: 'query',
      scope: this.config.scopes.join(' '),
      state,
      nonce,
    });
    return `${this.config.authority}/oauth2/v2.0/authorize?${p.toString()}`;
  }

  async exchangeCode(code: string): Promise<EntraTokenResponse> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(' '),
    });
    const res = await fetch(`${this.config.authority}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`entra_token_exchange_failed: ${res.status} ${text}`);
    }
    return (await res.json()) as EntraTokenResponse;
  }

  async fetchProfile(accessToken: string): Promise<EntraProfile> {
    const res = await fetch(
      'https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName',
      { headers: { authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      throw new Error(`graph_me_failed: ${res.status}`);
    }
    const data = (await res.json()) as {
      id: string;
      displayName?: string;
      mail?: string;
      userPrincipalName?: string;
    };
    const email = (data.mail ?? data.userPrincipalName ?? '').toLowerCase();
    return { oid: data.id, email, displayName: data.displayName ?? email };
  }

  async fetchGroupIds(accessToken: string): Promise<string[]> {
    const res = await fetch('https://graph.microsoft.com/v1.0/me/memberOf?$select=id&$top=999', {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { value?: Array<{ id?: string }> };
    return (data.value ?? [])
      .map((g) => g.id)
      .filter((x): x is string => typeof x === 'string');
  }
}
