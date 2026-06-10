/**
 * 依 HTTP status 給出全站一致的中文錯誤提示（issue 8.4 #39）。
 * 純函式，可被 vitest 測試；由 AsyncStates 的 ErrorState 使用。
 *
 * 慣例：401 未登入、403 權限不足、0 連線失敗（lib/api 的 network_error）。
 * 注意：401 預設已由 client 導向 SSO 登入（見 lib/auth），此提示用於關閉自動導向時。
 */
export function errorHint(status: number): string | null {
  if (status === 401) return '尚未登入：請先完成 Microsoft 365 SSO 登入後再試。';
  if (status === 403) return '權限不足：目前帳號無對應權限，請聯繫主管調整角色。';
  if (status === 0) return '無法連線後端 API：請確認後端服務已啟動（預設 http://localhost:3000）。';
  return null;
}
