# @wfms/web — 工作流程管理系統（前端）

Vite + React + TypeScript。對齊 `prototype/index.html` 的視覺與互動。

## 開發

```bash
pnpm install
pnpm --filter @wfms/web dev      # http://localhost:5173
pnpm --filter @wfms/web build    # tsc -b && vite build
pnpm --filter @wfms/web test     # vitest run
```

## 環境變數（issue 8.4 #39）

複製 `.env.example` 為 `.env.local` 後調整。所有變數需以 `VITE_` 開頭。

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `http://localhost:3000` | 後端 REST 基底 URL。 |
| `VITE_AUTH_REDIRECT` | `true` | 收到 401 時是否自動導向後端 SSO 登入（`GET /auth/login`）。除錯可設 `false`。 |
| `VITE_USE_SEED` | `false` | 是否允許以示範資料（seed）呈現（見下方策略）。 |
| `VITE_DEV_PROXY` | （空） | 選用。設定後 dev server 將 `/api` 轉發至此並去除 `/api` 前綴。 |

讀取點集中於 `src/lib/env.ts`。

## API client（前端串接基礎層）

- 入口：`src/api/client.ts`（公開匯入面）；實作於 `src/lib/api.ts`、`src/lib/auth.ts`、`src/lib/env.ts`。
- 一律帶 `credentials: 'include'`，以 Microsoft 365 SSO session cookie 認證（見 `docs/AUTH_SSO.md`）。
- 後端錯誤 `{ code, message }` 正規化為 `ApiError`（保留 `status` / `code`）；`status === 0` 表連線失敗。
- **401 全站一致**：任一呼叫回 401 時，client 預設導向 `GET /auth/login`（可由 `VITE_AUTH_REDIRECT=false` 關閉）。
- 用法：`apiGet<T>(path)` / `apiPost` / `apiPatch` / `apiDelete`；query 以 `buildQuery(params)` 組裝。

## 共用狀態元件

`src/components/AsyncStates.tsx` 提供 `LoadingState` / `ErrorState` / `EmptyState` 與 `toErrorState(err)`，
錯誤提示文案集中於 `src/components/errorHint.ts`，使各頁載入 / 錯誤呈現一致。

## seed fallback 策略

API 失敗時**明確顯示錯誤、不靜默退回 seed**，避免示範資料被誤認為真實資料。
僅當 `VITE_USE_SEED=true`（開發模式）時，feature 才可提供 seed 切換。
