# 8.4 交付物（#39 前端 API client 基礎層與環境設定）

本輪：2026-06-10（自動排程）。前端串接基礎層補齊；後端不動。

## 背景
8.2/8.3 已先行於 `src/lib/api.ts` 建立 fetch wrapper（credentials/錯誤正規化）與各 feature `api.ts`、
並讓 task-kanban / iso-trail 兩頁實際 fetch。8.4 補齊其中尚缺的「前置基礎」：401 全站導向、
環境設定慣例與文件、共用載入/錯誤/空狀態元件、seed fallback 策略。

## 變更
- `src/lib/env.ts`（新）：集中 `VITE_*` 讀取點。`API_BASE`、`IS_DEV`、`USE_SEED`、`AUTH_REDIRECT_ENABLED` + 純函式 `envFlag`。
- `src/lib/auth.ts`（新）：401 統一處理。`loginUrl` / `shouldRedirectOnUnauthorized`（純函式）、
  `handleUnauthorized()`（瀏覽器環境且啟用時 `window.location.assign(loginUrl())`，去重旗標防迴圈）、
  `configureAuthRedirect(handler)`（測試/特殊頁覆寫）。
- `src/lib/api.ts`（改）：`API_BASE` 改由 env 匯入並 re-export（既有 `import { API_BASE } from '../../lib/api'` 不受影響）；
  `request()` 於 401 時呼叫 `handleUnauthorized()` 後仍丟 `ApiError`。
- `src/components/errorHint.ts`（新）：`errorHint(status)` 純函式（401/403/0 對應中文提示）。
- `src/components/AsyncStates.tsx`（新）：`LoadingState` / `ErrorState` / `EmptyState` + `toErrorState(err)` 正規化。
- `src/api/client.ts`（新）：issue 指定路徑 `apps/web/src/api/client.ts`，作為公開匯入面，
  re-export lib/api + lib/auth + lib/env（實作仍在 lib/*，避免重複）。
- `src/features/task-kanban/TaskKanbanPage.tsx`、`src/features/iso-trail/IsoTrailPage.tsx`（改）：
  載入/錯誤狀態改用共用元件與 `toErrorState`，移除各頁重複的 errorHint 與 JSX（行為一致）。
- `apps/web/.env.example`（新）、`apps/web/README.md`（新）：環境變數與 client/seed 策略文件。
- `apps/web/vite.config.ts`（改）：選用 dev proxy，僅在設定 `VITE_DEV_PROXY` 時啟用（預設行為不變；
  client 以絕對 `API_BASE` 直連，故 proxy 非必要）。
- 測試（新）：`lib/env.test.ts`(4)、`lib/auth.test.ts`(3)、`components/errorHint.test.ts`(2)。

## 技術決策（供 review）
- **決策（8.4）**：不另建平行的 `api/client.ts` 實作，沿用既有 `lib/api.ts`（已被各 feature 匯入）為單一真實來源；
  `api/client.ts` 僅作 issue 指定路徑的「公開匯入面」re-export。**理由**：避免兩套 client 分裂；既有 import 零變動。
- **決策（8.4）**：401 預設導向 `GET /auth/login`，但以 `VITE_AUTH_REDIRECT` 控制、`typeof window` 守門、
  `configureAuthRedirect` 可覆寫。**理由**：滿足「全站一致」同時不破壞單元測試（node 無 window）與本機無後端除錯情境。
- **決策（8.4）**：seed fallback —— API 失敗明確顯示錯誤、**不靜默退回 seed**；僅 `VITE_USE_SEED=true` 開發模式才允許 seed 切換。
  **理由**：直接對應 issue 驗收「避免示範資料被當成真實資料」。
- **決策（8.4）**：dev proxy 設為選用（gated by `VITE_DEV_PROXY`）。**理由**：client 用絕對 base 已可直連，proxy 屬「視需要」。

## 驗證（sandbox 真實 pnpm）
- `tsc -b` ✅、`vite build` ✅、`vitest run` ✅ **110/110**（含本輪新增 9 測試；先前 101 → 110）。

## Handoff
- 共用元件已就緒，8.9~8.14 各前端頁建議統一 import `components/AsyncStates` 與（新串接）`api/client`。
- 401 導向在真實瀏覽器 + 後端環境的端到端行為，建議於 9.2 連同 SSO 一併人工確認。
- `docs/API串接缺口分析.md`（issue body F0 所引）目前 repo 不存在；本輪以 issue 內文為準，未補建該文件。
