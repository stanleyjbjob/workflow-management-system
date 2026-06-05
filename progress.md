# 專案開發進度（progress.md）

> 供自動化開發排程與後續人類複查掌握現況。每輪任務結束時更新。

## 技術堆疊（定案於 1.1）
- Monorepo：pnpm workspace（`apps/api` + `apps/web`）、Node 20、TypeScript。
- 後端：NestJS 10。資料庫：PostgreSQL 16（docker-compose）。
- ORM：**Prisma**（於 1.2 定案）。
- 認證：Entra ID OIDC（於 1.3 定案）。
- 授權：RBAC（於 1.4 定案）。
- CI：`.github/workflows/ci.yml` — pnpm install → `pnpm -r build` → `pnpm -r test`。

## 各 issue 狀態
| WBS | Issue | 狀態 | 備註 |
|-----|-------|------|------|
| 1.1 | #8 專案初始化與技術選型 | ✅ done | 骨架、CI、docker-compose |
| 1.2 | #9 資料模型與 schema | ✅ done | Prisma schema(16 實體/31 FK)、init migration、seed、PrismaModule |
| 1.3 | #10 Microsoft 365 SSO | ✅ done | Entra OIDC Auth Code flow、群組對角色、停用拒絕、LoginAudit 稽核、單元測試 |
| 1.4 | #11 RBAC | ✅ done | 權限矩陣、@Roles/@Permissions Guard、AccessScopeService 可見範圍、單元測試 |
| 2.1 | #12 流程引擎：定義/狀態機/推進 | ✅ 本輪完成 | 純引擎狀態機 + WorkflowService（建立/推進/退回循環）、17 項單元測試全綠 |
| 2.2~6.x | #13-#30 | 待辦 | 依 WBS 順序；下一個為 #13（2.2 流程定義設計器 UI），相依 2.1 已滿足 |

## 2.1 交付物（本輪）
- `apps/api/src/workflow/`：
  - `workflow-engine.ts`：**純領域狀態機**（無 DB 相依，可純函式測試）。
    - 型別：`EngineStepDefinition` / `EngineStepInstance` / `AdvancePlan` / `ReturnPlan` / `InitialInstanceBlueprint` / `WorkflowEngineError`（以 code 表示原因）。
    - 函式：`sortByOrder`、`validateDefinition`/`assertValidDefinition`（空定義→`no_steps`、重複 order→`duplicate_order`）、`firstStepDefinition`、`nextStepDefinition`、`planInitialInstances`（第一步 IN_PROGRESS、其餘 PENDING）、`planAdvance`（完成目前步驟→帶出下一步與負責角色；無下一步→案件 COMPLETED）、`planReturn`（退回到較早步驟，支援循環）。
  - `workflow.service.ts`：`WorkflowService`（注入 PrismaService）依引擎計畫落實 DB。
    - `createCaseFromWorkflow`：載入流程定義→驗證→物化每步驟一筆 StepInstance（第一步 IN_PROGRESS 並設 `Case.currentStepInstanceId`），整體於 `$transaction` 內完成。
    - `advanceCase`：完成目前步驟（COMPLETED + completedAt），啟用下一步（IN_PROGRESS + startedAt，選填指派 assignee）並更新 currentStepInstanceId；最後一步→`Case.status = COMPLETED`、currentStepInstanceId = null。
    - `returnCase`：目前步驟標 RETURNED 並於 `note` 留存退回原因（§8.4），目標較早步驟重啟為 IN_PROGRESS，currentStepInstanceId 指回目標。
    - `getCaseState`：回傳案件狀態 + 各步驟（含負責角色、承辦人）摘要。
  - `workflow.module.ts`：`WorkflowModule`（providers/exports `WorkflowService`），已匯入 `app.module.ts`。
  - `index.ts`：barrel 匯出。
  - 測試：`workflow-engine.spec.ts`（純引擎，含成功/邊界/錯誤路徑）、`workflow.service.spec.ts`（以記憶體假 Prisma 跑「建立→逐步推進→完成」與「推進→退回→再推進」完整循環）。**本機 tsc strict + jest 17 項全綠**。

## 技術決策（本輪，供 review）
- **決策**：將「決策」與「DB 寫入」分離——純狀態機核心（workflow-engine）只算 plan，service 依 plan 寫庫。
  **理由**：核心可不依賴資料庫做完整單元測試（與既有 rbac 純函式測試風格一致），降低流程規則演進的回歸風險。
- **決策**：建立案件時即「物化」所有 StepInstance（每步驟一筆），advance/return 只切換既有實例狀態。
  **理由**：schema 的 `Case.currentStepInstanceId`（唯一）與 `StepInstance.order` 已為此設計；退回循環可直接重啟既有實例，不必新增實例、流程歷程清楚。
- **決策**：退回只允許往「order 更小」的步驟（嚴格小於），否則 `invalid_return_target`。
  **理由**：對應需求「複測不過退回開發」屬回退；前進一律走 advance。
- **決策**：步驟「負責角色」隨轉換由 `StepDefinition.responsibleRoleId` 帶出；但「自動指派到哪一位使用者」僅在呼叫端明確提供 `assigneeId` 時才設定，否則保留待人工指派。
  **理由**：角色→預設承辦人之自動指派涉及業務規則（見下「待釐清」§12-1），先不臆測。

## 開發者需知
- 後續案件 REST API / 控制器尚未建立（本輪聚焦引擎服務層）。建立 case 端點時：以 `@UseGuards(SessionAuthGuard, PermissionsGuard) @Permissions('case:create'|'case:advance'...)` 套用，並用 `AccessScopeService.caseWhere(user)` 併入查詢 where 做可見範圍過濾。
- 「應填表單/產出」之**完成度把關**（advance 前需檢查必填表單是否已提交）尚未納入引擎，屬 2.3（#14 表單與產出文件管理）範圍；本輪僅完成步驟流轉。屆時可在 `planAdvance` 前加一道「表單就緒」檢查。
- 引擎錯誤以 `WorkflowEngineError.code` 表示，service 統一轉為 `BadRequestException(code)`；新增轉換規則時更新 `WorkflowEngineErrorCode` 聯集即可。
- 本地 / CI 經 `pnpm install` 會觸發 `prisma generate`（需能存取 binaries.prisma.sh）；workflow 測試不需資料庫即可跑。
- 待釐清（需求 §12）：
  - §12-1 跨角色移交是否需主管核可、流程是否一律由特定角色發起 → 影響 advance/return 是否要加核可關卡與「角色→預設承辦人」自動指派；目前保留彈性（僅由呼叫端指定 assignee）。
  - §12-2 失敗原因分類、§12-4 簽核層級 → 影響 returnCase 原因欄位是否要改為列舉、advance 是否需簽核關卡。
