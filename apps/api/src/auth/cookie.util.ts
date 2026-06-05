/**
 * Cookie 解析 / 序列化（零外部相依，避免引入 cookie-parser）。
 */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

export interface CookieOptions {
  httpOnly?: boolean;
  maxAge?: number; // seconds
  path?: string;
  sameSite?: 'Lax' | 'Strict' | 'None';
  secure?: boolean;
}

export function serializeCookie(name: string, value: string, opts: CookieOptions = {}): string {
  const segs: string[] = [`${name}=${encodeURIComponent(value)}`];
  segs.push(`Path=${opts.path ?? '/'}`);
  if (typeof opts.maxAge === 'number') segs.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  if (opts.httpOnly) segs.push('HttpOnly');
  if (opts.sameSite) segs.push(`SameSite=${opts.sameSite}`);
  if (opts.secure) segs.push('Secure');
  return segs.join('; ');
}
