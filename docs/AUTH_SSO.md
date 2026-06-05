# Microsoft 365 / Entra ID SSO（需求 1.3）

本文說明後端 `apps/api` 的單一登入（SSO）實作、設定方式與設計決策。

## 技術選型與決策

- **授權流程**：OAuth 2.0 / OpenID Connect Authorization Code Flow（confidential client，使用 client secret）。
- **零新增執行期相依**：以 Node 20 內建 `fetch` 與 `crypto` 實作，不引入 `passport` / `openid-client` / `jsonwebtoken` 等套件，降低供應阔與建置風險。
- **身分取得**：以 authorization code 向 Entra token 端點交換 access token（TLS + client secret 已認證回應來源），隨即以該 token 呼叫 Microsoft Graph `/me`（身分）與 `/me/memberOf`（群組）；因此無需自行驗證 id_token 簽章（JWKS）。
- **系統 session**：以 HS256（`AUTH_SESSION_SECRET`）簽發輕量 JWT，以 httpOnly cookie `wfms_session` 帶回。

## 端點

| Method | Path | 說明 |
|--------|------|------|
| GET | `/auth/login` | 產生 state/nonce（簽名存於 `wfms_oauth_state` cookie）並 302 導向 Entra 授權端點。未設定時回 503。 |
| GET | `/auth/callback` | 驗 state → 換 token → 取身分/群組 → 建立/更新使用者 → 簽發 session cookie → 導回前端。 |
| GET | `/auth/me` | 回傳目前登入者（`SessionAuthGuard` 保護）。 |
| POST | `/auth/logout` | 清除 session cookie。 |

## 群組 ↔ 角色對應

採資料驅動：在 `Role.entraGroupId` 填入對應的 Entra 群組 Object ID。登入時依使用者所屬群組查出對應角色並同步。

同步策略（`syncUserRoles`）：只調整「由 Entra 群組對應（`entraGroupId` 非空）」的角色，**保留手動指派（無 entraGroupId）的角色**，避免每次登入洗掉人工調整。

> 決策：首次 SSO 登入且無任何群組對應時，使用者以「無角色」建立（需管理者後續指派）。是否設預設角色屬業務規則，待 1.4 RBAC 與使用者確認。

## 停用帳號與例外帳號

- Entra 停用帳號後，該帳號無法取得 token，登入自然失敗。
- 另於系統側以 `User.isActive=false` 可立即阻擋登入（`upsertUserFromProfile` 拋 `account_disabled`）。
- **例外帳號**：以 `User.isLocalAccount=true` 標記的少量本地帳號不受 Entra 控管（供紧急/破率使用），其登入機制將於後續 issue 補上。

## 登入稽核（ISO 27001）

每次登入成功/失敗皆寫入 `LoginAudit`：`eventType`、`success`、`reason`、`userId`/`email`/`entraOid`、`ipAddress`、`userAgent`、`createdAt`。

## 環境變數

見 `.env.example`：`ENTRA_TENANT_ID` / `ENTRA_CLIENT_ID` / `ENTRA_CLIENT_SECRET` / `ENTRA_REDIRECT_URI` / `ENTRA_SCOPES` / `AUTH_SESSION_SECRET` / `AUTH_SESSION_TTL` / `AUTH_POST_LOGIN_REDIRECT` / `WEB_BASE_URL`。

## 待辦 / 下一步

- 例外（本地）帳號的實際登入機制與密碼/二步驗證。
- 以 Entra 定期同步帳號啟用狀態至 `User.isActive`（可由排程任務）。
- e2e 測試（需資料庫）與 controller 層測試。
- 生產環境如走 reverse proxy，需設 trust proxy 以正確取得 client IP。
