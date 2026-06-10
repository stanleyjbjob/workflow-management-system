/**
 * SSO session 相關 REST 呼叫（issue 8.5 #40）。
 * 共用 lib/api：自動帶 cookie，401 由 client 統一處理（lib/auth）。
 */
import { apiGet, apiPost } from '../../lib/api';
import type { SessionUser } from './types';

/** 取得目前登入者（401 時 client 會依設定導向 SSO 並 throw ApiError）。 */
export function fetchCurrentUser(): Promise<SessionUser> {
  return apiGet<SessionUser>('/auth/me');
}

/** 登出：清除後端 session cookie。 */
export function logout(): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>('/auth/logout');
}
