/**
 * 前端 SSO session 型別（issue 8.5 #40）。
 *
 * `SessionUser` 與後端 `GET /auth/me` 回傳一致（見 apps/api/src/auth/auth.service.ts）。
 * `SessionState` 為畫面狀態機：loading / authenticated / unauthenticated / error。
 */

/** 目前登入者（對應後端 SessionUser）。 */
export interface SessionUser {
  sub: string;
  email: string;
  name: string;
  roles: string[];
}

/** App 啟動取得 /auth/me 後的畫面狀態。 */
export type SessionState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: SessionUser }
  | { status: 'unauthenticated' } // 401 且未自動導向（AUTH_REDIRECT=false）時呈現登入提示
  | { status: 'error'; message: string }; // 連線失敗或其他非 401 錯誤
