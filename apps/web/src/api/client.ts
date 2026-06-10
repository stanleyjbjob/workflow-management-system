/**
 * 前端 REST client 公開入口（issue 8.4 #39 指定路徑 `apps/web/src/api/client.ts`）。
 *
 * 實作落地於：
 * - `lib/api.ts`：fetch wrapper（VITE_API_BASE_URL、credentials:'include'、JSON 解析、{code,message} 正規化）。
 * - `lib/auth.ts`：401 統一導向 `GET /auth/login`。
 * - `lib/env.ts`：環境設定（API_BASE、USE_SEED、AUTH_REDIRECT_ENABLED…）。
 *
 * 既有 feature 仍直接 import 自 `lib/api`（不變動）；新串接建議由本檔集中匯入。
 */
export { API_BASE, ApiError, apiGet, apiPost, apiPatch, apiDelete, buildQuery, toErrorBody } from '../lib/api';
export type { QueryValue, ApiErrorBody } from '../lib/api';
export { loginUrl, handleUnauthorized, configureAuthRedirect, shouldRedirectOnUnauthorized, AUTH_LOGIN_PATH } from '../lib/auth';
export { IS_DEV, USE_SEED, AUTH_REDIRECT_ENABLED, envFlag } from '../lib/env';
