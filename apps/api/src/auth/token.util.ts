import { createHmac, timingSafeEqual } from 'crypto';

/**
 * 極簡 HS256 JWT 簽發 / 驗證工具（零外部相依）。
 * 用於系統 session cookie 與 OAuth state cookie，避免引入額外套件。
 * 注意：這是「我方簽發」的 token，非用來驗證 Entra 的 id_token；
 * Entra 身分以 authorization code 交換（TLS + client secret）後直接向 Graph 取得，故無需自行驗 JWKS。
 */
function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlJson(obj: unknown): string {
  return base64url(JSON.stringify(obj));
}

function fromBase64url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export interface SignOptions {
  expiresInSeconds?: number;
}

export function signToken(
  payload: Record<string, unknown>,
  secret: string,
  opts: SignOptions = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const body: Record<string, unknown> = {
    ...payload,
    iat: now,
    ...(opts.expiresInSeconds ? { exp: now + opts.expiresInSeconds } : {}),
  };
  const head = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const data = base64urlJson(body);
  const signingInput = `${head}.${data}`;
  const sig = base64url(createHmac('sha256', secret).update(signingInput).digest());
  return `${signingInput}.${sig}`;
}

export function verifyToken<T = Record<string, unknown>>(
  token: string,
  secret: string,
): T | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, data, sig] = parts;
  const expected = base64url(createHmac('sha256', secret).update(`${head}.${data}`).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(fromBase64url(data).toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload as T;
}
