/**
 * SSO session React hook（issue 8.5 #40）。
 *
 * App 啟動時呼叫 GET /auth/me：
 * - 成功 → authenticated（顯示真實姓名/email/角色）。
 * - 401 → client 依 AUTH_REDIRECT 決定是否自動導向 /auth/login；狀態置 unauthenticated。
 * - 連線/其他錯誤 → error，提供重試。
 *
 * `login()` 手動導向 SSO；`logout()` 呼叫 POST /auth/logout 並清除前端狀態。
 */
import { useCallback, useEffect, useState } from 'react';
import { loginUrl } from '../../lib/auth';
import { fetchCurrentUser, logout as logoutApi } from './api';
import { toSessionState } from './session-state';
import type { SessionState } from './types';

export interface UseSession {
  state: SessionState;
  reload: () => void;
  login: () => void;
  logout: () => Promise<void>;
}

export function useSession(): UseSession {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    fetchCurrentUser()
      .then((user) => setState(toSessionState({ ok: true, user })))
      .catch((error) => setState(toSessionState({ ok: false, error })));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const login = useCallback(() => {
    if (typeof window !== 'undefined') window.location.assign(loginUrl());
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutApi();
    } catch {
      // 即便登出 API 失敗，仍清除前端狀態；後續受保護請求會再次觸發 SSO。
    }
    setState({ status: 'unauthenticated' });
  }, []);

  return { state, reload, login, logout };
}
