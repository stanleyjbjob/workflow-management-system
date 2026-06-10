/**
 * /auth/me 結果 → 畫面狀態的純對應（issue 8.5 #40，可被 vitest 測試）。
 *
 * - 成功：authenticated。
 * - ApiError 401：unauthenticated（client 已視 AUTH_REDIRECT 設定決定是否導向 SSO）。
 * - 其他（含 status 0 連線失敗、5xx）：error 並保留訊息。
 */
import { ApiError } from '../../lib/api';
import type { SessionState, SessionUser } from './types';

export type FetchResult =
  | { ok: true; user: SessionUser }
  | { ok: false; error: unknown };

export function toSessionState(result: FetchResult): SessionState {
  if (result.ok) return { status: 'authenticated', user: result.user };
  const err = result.error;
  if (err instanceof ApiError) {
    if (err.status === 401) return { status: 'unauthenticated' };
    return { status: 'error', message: err.message };
  }
  return { status: 'error', message: err instanceof Error ? err.message : '未知錯誤' };
}
