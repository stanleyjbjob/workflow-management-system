# 專案開發進度（progress.md）

> 供自動化開發排程與後續人類複查掌握現況。每輪任務結束時更新。

## 技術堆疊（定案於 1.1）
- Monorepo：pnpm workspace（`apps/api` + `apps/web`）、Node 20、TypeScript。
- 後端：NestJS 10。資料庫：PostgreSQL 16（docker-compose）。
- ORM：**Prisma**（於 1.2 定案）。
- 認證：Entra ID OIDC（於 1.3 定案）。
- 授權：RBAC（於 1.4 定案，見下）。
- CI：`.github/workflows/ci.yml` — pnpm install → `pnpm -r build` → `pnpm -r test`。

## 各 issue 狀態
| WBS | Issue | 狀態 | 備註 |
|-----|-------|------|------|
| 1.1 | #8 專案初始化與技術選型 | ✅ done | 骨架、CI、docker-compose |
| 1.2 | #9 資料模型與 schema | ✅ done | Prisma schema(16 實體/31 FK)、init migration、seed、PrismaModule |
| 1.3 | #10 Microsoft 365 SSO | ✅ done | Entra OIDC Auth Code flow、群組對角色、停用拒絕、LoginAudit 稽核、單元測試 |
| 1.4 | #11 RBAC | ✅ 本輪完成 | 權限矩陣、@Roles/@Permissions Guard、AccessScopeService 可見範圍、單元測試 |
| 2.x~6.x | #12-#30 | 待辦 | 依 WBS 順序；下一個為 #12（2.1 流程引擎），相依 1.2 已滿足 |

## 1.4 交付物（本輪）
- `apps/api/src/rbac/`：
  - `permissions.ts`：`Permission` 型別、`ROLE_PERMISSIONS` 權限矩陣（六角色，資料驅動）、`FLOW_VISIBILITY` 可見流程表，與 helper（`permissionsForRoles` / `hasPermission` / `hasAllPermissions` / `hasAnyRole` / `isManager` / `visibleFlowTypesForRoles`）。
  - `roles.decorator.ts` / `permissions.decorator.ts`：`@Roles(...)` / `@Permissions(...)`。
  - `roles.guard.ts` / `permissions.guard.ts`：`RolesGuard`（任一角色即放行）/ `PermissionsGuard`（需全部權限）；無權限丟 `ForbiddenException`、未登入丟 `UnauthorizedException`。須排在 `SessionAuthGuard` 之後（依賴 `request.user`）。
  - `access-scope.service.ts`：`AccessScopeService` 依角色計算可見範圍 —— `caseWhere` / `projectWhere` / `workflowWhere`（回傳 Prisma where 片段，主管回傳 `{}` 綜覽全部），與 `canViewCase` / `canViewProject` 及對應 `assert*`。
  - `rbac.module.ts`：`@Global() RbacModule`，已匯入 `app.module.ts`。
  - 測試：`permissions.spec.ts`、`roles.guard.spec.ts`、`permissions.guard.spec.ts`、`access-scope.service.spec.ts`。
- 角色↔權限設計（對應需求 §2 / §8.5）：
  - MANAGER：全權限、可見全部流程/案件/專案（綜覽）。
  - SALES：SALES 流程；建立/推進案件、填表、附件、專案 CRUD。
  - CONSULTANT：ONBOARDING+CUSTOMIZATION 流程；可簽核（form:approve）、可指派（case:assign）。
  - ENG_LEAD：ENVIRONMENT+CUSTOMIZATION 流程；可指派（case:assign）。
  - ENGINEER：ENVIRONMENT+CUSTOMIZATION 流程；推進案件、填表、附件（不可指派/簽核）。
  - ASSISTANT：唯讀最小集合（暫不納入，預留擴充）。

## 開發者需知
- RBAC 為「地基」：guard/decorator/scope 已就緒，後續功能模組（流程、案件、專案 CRUD）直接注入 `AccessScopeService` 並以 `@UseGuards(SessionAuthGuard, PermissionsGuard) @Permissions(...)` 套用。查詢清單時把 `service.caseWhere(user)` 併入 Prisma `where` 即可達成可見範圍過濾。
- 本地 / CI 經 `pnpm install` 會觸發 `prisma generate`（需能存取 binaries.prisma.sh）。
- 首次使用資料庫：`docker compose up -d db` → `pnpm --filter @wfms/api prisma:deploy` → `pnpm --filter @wfms/api db:seed`。
- SSO 設定見 `docs/AUTH_SSO.md`。
- 待釐清（需求 §12 第 1 項）：跨角色移交是否需主管核可、流程是否一律由特定角色發起——目前 RBAC 僅做「可見/可操作」粗粒度控管，移交核可等業務規則待主管確認後於流程引擎（2.1）細化。
- 許多業務規則仍待釐清（見需求規格第 12 節），模型保留彈性欄位（如 version、JSON options）。
