# 8.6 後端 WorkflowDefinition 流程定義 CRUD REST（#41）增量筆記

完成日期：2026-06-10（自動排程單輪完成）

## 本輪落地

- `apps/api/src/workflow/workflow-definitions.service.ts`：流程定義 CRUD service。
- `apps/api/src/workflow/workflow-definitions.controller.ts`：`GET/POST /workflows`、`GET/PATCH/DELETE /workflows/:id`（SessionAuthGuard + PermissionsGuard；查詢 `workflow:read`、維護 `workflow:manage`；錯誤經 guardEngine 轉 400 {code,message}）。
- `apps/api/prisma/schema.prisma` + migration `20260610150000_workflow_designer_json`：WorkflowDefinition 增加 `designer Json?`。
- `workflow.module.ts` 註冊 controller/provider；`index.ts` 匯出。
- 測試：`workflow-definitions.service.spec.ts`（FakePrisma，10 案）。API 全套 jest 32 suites/596 案綠；`pnpm --filter @wfms/api build`（真實 prisma generate client）綠。

## 關鍵設計決策（理由見 issue #41 comment）

1. **雙寫策略**：設計器草稿（WorkflowDraft）完整存 `designer Json`（唯一真實來源，保 round-trip 不失真），同一交易內全量重建 StepDefinition 正規列供案件引擎（createCaseFromWorkflow）使用。
2. 草稿 `forms`（應填表單/應產出 + isoMapping）僅存於 designer Json，不建 FormDefinition/StepForm 實體 —— §12-3 表單實際欄位未定案（#38），定案後再正規化。
3. 刪除保護：被 Case 引用 → 改 `isActive=false`（軟刪，回 `{deleted:false, deactivated:true}`）；無引用 → 實刪（步驟 onDelete: Cascade）。
4. 步驟 order 服務端 reindex 1..n（同 web `reindex`）；`nextStepId` 鏈不維護（引擎只用 order，全 codebase 無讀取點）。
5. 客戶端提供之 id（workflow/step）直接作為 DB id（round-trip 保 id 穩定）；缺省以 randomUUID 補。
6. 錯誤碼：`invalid_name` / `invalid_flow_type` / `invalid_step_name` / `unknown_role` / `duplicate_step_id` / `duplicate_workflow_version`（P2002 映射）/ 404 `workflow_not_found`。

## 對後續任務的影響

- **#46（前端設計器改接 REST）**：路由/形狀已對齊 `WorkflowRepository` 介面（list→WorkflowSummary[]、get/save→WorkflowDraft、remove）。save 用 `PATCH /workflows/:id`（存在）或 `POST /workflows`（新建）；前端 seed 流程可在首次 list 為空時逐筆 POST。
- migration 在 sandbox 無法套真 DB，**migration-check / integration-test 由 CI 驗證**（本次僅 ADD COLUMN nullable，低風險）。
