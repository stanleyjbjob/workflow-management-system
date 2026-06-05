# 專案開發進度（progress.md）

> 供自動化開發排程與後續人類複查掌握現況。每輪任務結束時更新。

## 技術堆疊（定案於 1.1）
- Monorepo：pnpm workspace（`apps/api` + `apps/web`）、Node 20、TypeScript。
- 後端：NestJS 10。資料庫：PostgreSQL 16（docker-compose）。
- ORM：**Prisma**（於 1.2 定案）。
- CI：`.github/workflows/ci.yml` — pnpm install → `pnpm -r build` → `pnpm -r test`。

## 各 issue 狀態
| WBS | Issue | 狀態 | 備註 |
|-----|-------|------|------|
| 1.1 | #8 專案初始化與技術選型 | ✅ done | 骨架、CI、docker-compose |
| 1.2 | #9 資料模型與 schema | ✅ 本輪完成 | Prisma schema(16 實體/31 FK)、init migration、seed、PrismaModule |
| 1.3 | #10 Microsoft 365 SSO | 待辦 | 下一個（相依 1.1） |
| 1.4 | #11 RBAC | 待辦 | 相依 1.2 |
| 2.x~6.x | #12-#30 | 待辦 | 依 WBS 順序 |

## 1.2 交付物（本輪）
- `apps/api/prisma/schema.prisma`：16 個 model、9 個業務 enum、全部外鍵關聯。
- `apps/api/prisma/migrations/20260606000000_init/`：init migration SQL。
- `apps/api/prisma/seed.ts`：idempotent 種子資料（角色/使用者/銷售流程/示範專案）。
- `apps/api/src/prisma/`：PrismaModule / PrismaService（全域）。
- `docs/DATA_MODEL.md`：資料模型說明與使用方式。

## 開發者需知
- 本地 / CI 跡 `pnpm install` 會觸發 `prisma generate`（需能存取 binaries.prisma.sh）。
- 首次使用資料庫：`docker compose up -d db` → `pnpm --filter @wfms/api prisma:deploy` → `pnpm --filter @wfms/api db:seed`。
- 許多業務規則仍待釐清（見需求規格第 12 節），模型保留彈性欄位（如 version、JSON options）。
