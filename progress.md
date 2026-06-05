# 專案開發進度（progress.md）

> 供自動化開發排程與後續人類複查掌握現況。每輪任務結束時更新。

## 技術堆疊（定案於 1.1）
- Monorepo：pnpm workspace（`apps/api` + `apps/web`）、Node 20、TypeScript。
- 後端：NestJS 10。資料庫：PostgreSQL 16（docker-compose）。
- ORM：**Prisma**（於 1.2 定案）。
- 認證：Entra ID OIDC（於 1.3 定案，見下）。
- CI：`.github/workflows/ci.yml` — pnpm install → `pnpm -r build` → `pnpm -r test`。

## 各 issue 狀態
| WBS | Issue | 狀態 | 備註 |
|-----|-------|------|------|
| 1.1 | #8 專案初始化與技術選型 | ✅ done | 骨架、CI、docker-compose |
| 1.2 | #9 資料模型與 schema | ✅ done | Prisma schema(16 實體/31 FK)、init migration、seed、PrismaModule |
| 1.3 | #10 Microsoft 365 SSO | ✅ 本輪完成 | Entra OIDC Auth Code flow、群組對角色、停用拒絕、LoginAudit 稽核、單元測試 |
| 1.4 | #11 RBAC | 待辦 | 下一個（相依 1.2）；可接手 1.3 的 SessionAuthGuard / CurrentUser |
| 2.x~6.x | #12-#30 | 待辦 | 依 WBS 順序 |

## 1.3 交付物（本輪）
- `apps/api/src/auth/`：AuthModule / AuthController / AuthService / EntraClient / AuthConfigService / SessionAuthGuard / CurrentUser 與 token/cookie 工具。
- 零新增執行期相依：使用 Node 20 global `fetch` + `crypto`（未加 passport/openid-client/jsonwebtoken）。
- `LoginAudit` 資料模型 + migration `20260606010000_login_audit`；User 新增 `loginAudits` 關聯。
- `app.module.ts` 匯入 AuthModule；`main.ts` CORS 開啟 credentials。
- `docs/AUTH_SSO.md`；git `.env.example` 補上 SSO/session 設定。
- 測試：`token.util.spec.ts`、`auth.service.spec.ts`（群組對角色、停用拒絕、callback 成功/失敗稽核）。

## 開發者需知
- 本地 / CI 跡 `pnpm install` 會觸發 `prisma generate`（需能存取 binaries.prisma.sh）。
- 首次使用資料庫：`docker compose up -d db` → `pnpm --filter @wfms/api prisma:deploy` → `pnpm --filter @wfms/api db:seed`。
- SSO 設定見 `docs/AUTH_SSO.md`；Entra App 需設 redirect URI `http://localhost:3000/auth/callback` 並授予 Graph `User.Read`。
- 許多業務規則仍待釐清（見需求規格第 12 節），模型保留彈性欄位（如 version、JSON options）。
