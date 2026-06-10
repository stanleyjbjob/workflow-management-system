/**
 * 前端環境設定彙整（issue 8.4 #39）。
 *
 * 所有 `VITE_*` 環境變數的單一讀取點，避免散落於各 feature。
 * - `API_BASE`：後端 REST 基底（與健康檢查、各 feature client 一致）。
 * - `USE_SEED`：是否允許以示範資料（seed）呈現；預設 false。
 *   依 issue 8.4 策略，API 失敗時不靜默退回 seed，僅在明確開啟此旗標的「開發模式」下，
 *   feature 才可提供 seed 切換，避免示範資料被誤認為真實資料。
 * - `AUTH_REDIRECT_ENABLED`：收到 401 時是否自動導向後端 `GET /auth/login`（SSO）；預設 true。
 *   本機未啟動後端或撰寫測試時，可設 `VITE_AUTH_REDIRECT=false` 關閉，改以畫面提示處理。
 *
 * `envFlag` 為純函式，可被 vitest 直接測試。
 */

/** 將環境變數字串解析為布林（容忍 true/false/1/0/yes/no/on/off；未提供或無法解析時用 fallback）。 */
export function envFlag(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  const v = String(value).trim().toLowerCase();
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
  if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true;
  return fallback;
}

/** 後端 REST 基底 URL（預設 http://localhost:3000，與 App.tsx 健康檢查一致）。 */
export const API_BASE: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

/** 是否為 Vite 開發模式。 */
export const IS_DEV: boolean = import.meta.env.DEV === true;

/** 是否允許以 seed 示範資料呈現（預設 false；見檔頭策略說明）。 */
export const USE_SEED: boolean = envFlag(import.meta.env.VITE_USE_SEED, false);

/** 收到 401 時是否自動導向 SSO 登入（預設 true）。 */
export const AUTH_REDIRECT_ENABLED: boolean = envFlag(import.meta.env.VITE_AUTH_REDIRECT, true);
