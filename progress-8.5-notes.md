# 8.5 前端 SSO 認證串接（#40）進度註記 — ✅ done（2026-06-10）

> 自動排程本輪交付。供後續輪次與人類複查掌握現況。

## 本輪完成
新增 `apps/web/src/features/auth/`（沿用既有 `lib/` 純函式+測試、`features/` 分層風格）：

- `types.ts`：`SessionUser`（sub/email/name/roles，對齊後端 `GET /auth/me`）、`SessionState` 狀態機（loading / authenticated / unauthenticated / error）。
- `roles.ts`（純函式，可測）：`ROLE_LABELS`（MANAGER/SALES/CONSULTANT/ENG_LEAD/ENGINEER/ASSISTANT → 繁中，依 `docs/DATA_MODEL.md`）、`roleLabel` / `primaryRole` / `hasRole` / `isManager` / `describeRoles` / `viewRoleOptions`（主管可跨角色檢視、其餘僅自身角色）。
- `session-state.ts`（純函式，可測）：`toSessionState` 將 /auth/me 成功或 `ApiError` 映射為畫面狀態（401→unauthenticated；status 0 連線失敗、5xx→error 並保留訊息）。
- `api.ts`：`fetchCurrentUser`（`apiGet('/auth/me')`）、`logout`（`apiPost('/auth/logout')`）。
- `useSession.ts`：React hook，啟動載入、`reload` / `login`（導向 `loginUrl()`）/ `logout`（呼叫後端並清前端狀態）。
- `AccountBadge.tsx`：帳號徽章（姓名 + email title + 角色標籤）；loading / 未登入（登入鈕）/ error（重試）各狀態；主管顯示「檢視角色」下拉。
- `index.ts`、`roles.test.ts`、`session-state.test.ts`（共 15 案）。

`App.tsx`：header 右側掛 `AccountBadge`，啟動以 `useSession` 取代寫死帳號；新增 `viewRole`（檢視過濾用，登入後預設使用者主要角色）；系統狀態頁顯示登入者姓名/email。

## 驗收對照（issue #40）
- ✅ App 啟動呼叫 `GET /auth/me` 顯示真實姓名/email/角色，取代寫死帳號徽章。
- ✅ 未登入（401）導向 `GET /auth/login`：重用 8.4 `lib/api` → `handleUnauthorized()`（依 `VITE_AUTH_REDIRECT` 預設導向），全站一致。
- ✅ 登出按鈕呼叫 `POST /auth/logout` 並清除前端狀態。
- ✅ 角色下拉降級為「檢視過濾」用途，僅主管可跨角色檢視；真實權限以後端 RBAC 為準。

## 技術決策＋理由
- **401 不另寫一套**：直接重用 8.4 `lib/api`/`lib/auth` 的統一 401 導向；測試環境可 `configureAuthRedirect` 覆寫避免真的導向。
- **角色僅前端檢視過濾**：符合 issue「降級為檢視過濾」要求，避免前端誤判權限。
- **純邏輯抽出可測、UI 不寫元件測試**：沿用本 repo 既有慣例（無 jsdom，僅以 vitest 測純函式）。

## 驗證
sandbox 真實 npm + 工具鏈：`vitest run` **125/125 全綠**（新增 15）、`tsc -b` ✅、`vite build` ✅。

## Handoff（下一輪／人類）
- `viewRole` 目前僅存於 App state，尚未下傳各 feature 作實際視角過濾 — 待 8.9~8.14 各頁改接 REST 時消費。
- 真實 Entra 環境端到端登入/登出驗證需 `ENTRA_*` env（與 9.2 一併）。
- 後端 `SessionUser.roles` 排序未定義；前端 `primaryRole` 取第一個，若需「主要角色」語意請後端明確排序或加欄位。
- **下一輪建議接 #41（8.6 後端 WorkflowDefinition 流程定義 CRUD REST）**：無相依、為剩餘可動工開發任務中編號最小者。
- 註：主 `progress.md` 表格的 8.5 列狀態請於後續輪次併入更新（本輪以本註記檔記錄，避免大檔重寫風險）。
