/**
 * 401 未登入統一處理（issue 8.4 #39）。
 *
 * 後端以 Microsoft 365 SSO session cookie 認證（見 docs/AUTH_SSO.md）。
 * 任一 REST 呼叫回 401 時，client（lib/api.ts）會呼叫 `handleUnauthorized()`：
 * 預設導向後端 `GET /auth/login`（302 轉向 Entra 授權端點），全站行為一致。
 *
 * - `loginUrl` / `shouldRedirectOnUnauthorized` 為純函式，可被 vitest 測試。
 * - 測試或特殊頁面可用 `configureAuthRedirect(handler)` 覆寫（傳 null 還原預設並重置去重旗標）。
 * - 以 `redirected` 旗標避免重複導向造成迴圈。
 */
import { API_BASE, AUTH_REDIRECT_ENABLED } from './env';

/** SSO 登入端點路徑。 */
export const AUTH_LOGIN_PATH = '/auth/login';

/** 組登入 URL（預設以 API_BASE 為基底）。 */
export function loginUrl(base: string = API_BASE): string {
  return `${base}${AUTH_LOGIN_PATH}`;
}

/** 純決策：是否應於 401 時導向（需啟用且具備瀏覽器環境）。 */
export function shouldRedirectOnUnauthorized(opts: { enabled: boolean; hasWindow: boolean }): boolean {
  return opts.enabled && opts.hasWindow;
}

let redirected = false;
let overrideHandler: (() => void) | null = null;

/** 覆寫 401 處理（測試 / 特殊頁面）。傳入 null 還原預設並重置去重旗標。 */
export function configureAuthRedirect(handler: (() => void) | null): void {
  overrideHandler = handler;
  redirected = false;
}

/** 收到 401 時的統一處理：預設導向 SSO 登入（瀏覽器環境且啟用時）。 */
export function handleUnauthorized(): void {
  if (overrideHandler) {
    overrideHandler();
    return;
  }
  const hasWindow = typeof window !== 'undefined' && typeof window.location !== 'undefined';
  if (!shouldRedirectOnUnauthorized({ enabled: AUTH_REDIRECT_ENABLED, hasWindow })) return;
  if (redirected) return;
  redirected = true;
  window.location.assign(loginUrl());
}
