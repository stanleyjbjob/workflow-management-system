# 專案開發進度（progress.md）

> 供自動化開發排程與後續人類複查掌握現況。每輪任務結束時更新。

## 技術堆疊（定案於 1.1）
- Monorepo：pnpm workspace（`apps/api` + `apps/web`）、Node 20、TypeScript。
- 後端：NestJS 10。資料庫：PostgreSQL 16（docker-compose）。
- ORM：**Prisma**（於 1.2 定案）。
- 認證：Entra ID OIDC（於 1.3 定案）。
- 授權：RBAC（於 1.4 定案）。
- 前端：**Vite + React 18 + TypeScript**（apps/web）；測試 **vitest**（於 2.2 引入）。
- 後端測試：**jest + ts-jest**（apps/api）。
- CI：`.github/workflows/ci.yml` — pnpm install（`--frozen-lockfile=false`）→ `pnpm -r build` → `pnpm -r test`。

## 各 issue 狀態
| WBS | Issue | 狀態 | 備註 |
|-----|-------|------|------|
| 1.1 | #8 專案初始化與技術選型 | ✅ done | 骨架、CI、docker-compose |
| 1.2 | #9 資料模型與 schema | ✅ done | Prisma schema(16 實體/31 FK)、init migration、seed、PrismaModule |
| 1.3 | #10 Microsoft 365 SSO | ✅ done | Entra OIDC Auth Code flow、群組對角色、停用拒絕、LoginAudit 稽核、單元測試 |
| 1.4 | #11 RBAC | ✅ done | 權限矩陣、@Roles/@Permissions Guard、AccessScopeService 可見範圍、單元測試 |
| 2.1 | #12 流程引擎：定義/狀態機/推進 | ✅ done | 純引擎狀態機 + WorkflowService、17 項單元測試 |
| 2.2 | #13 流程定義設計器 UI | ✅ done | apps/web 前端設計器；步驟/角色/表單/下一步/流程設定，localStorage 持久化，vitest 測試 |
| 2.3 | #14 表單與產出文件管理 | ✅ 本輪完成 | apps/api `forms/` 純引擎（驗證/簽核/必填把關/跨步驟引用）+ FormsService，25 項 jest 單元測試 |
| 2.4~6.x | #15-#30 | 待辦 | 依 WBS 順序；下一個為 #15（2.4 作業範本附檔），相依 2.2 已滿足 |

## 2.3 交付物（本輪）
- `apps/api/src/forms/`：後端「表單與產出文件管理」模組（對應需求規格 §8.2）。
  - `forms-engine.ts`：**純邏輯**（無 DB/Nest 相依，與 2.1 workflow-engine 同風格）。
    - `validateFormDefinition`：欄位 key/order 不重複、SELECT/MULTISELECT 需有選項。
    - `validateFieldValues`：依型別驗證（必填、NUMBER、DATE、SELECT、MULTISELECT、CHECKBOX），回傳欄位層錯誤。
    - `planSubmit`：驗證通過才生成 SUBMITTED 計畫（記錄送出人/時間）。
    - `planApprove` / `planReject`：**簽核軌跡**—僅簽核類(isSignable)且已 SUBMITTED 可核可/退回，記錄誰於何時。
    - `unmetRequiredForms` / `requiredFormsSatisfied`：步驟必填表單把關（簽核類需 APPROVED、一般需 SUBMITTED），供 2.1 advance 前檢查。
    - `resolveReferences` / `toPrefillData`：跨步驟帶出前段產出（報價單/客製需求文件 → 後續引用），只採用較早步驟、同表取最新一筆、來源可追溯。
  - `forms.service.ts`：NestJS `FormsService`（依 Prisma 落實計畫）：createForm/attachFormToStep/getStepForms/submitForm/approveSubmission/rejectSubmission/listCaseSubmissions/getStepCompletionGate/resolveStepReferences。
  - `forms.module.ts`：`FormsModule`（提供並 export FormsService；PrismaModule 為全域）；已於 `app.module.ts` 註冊。
  - `forms-engine.spec.ts`：jest 單元測試（25 項，全綠）。

## 技術決策（本輪，供 review）
- **決策**：表單邏輯拆為純核心 + 服務（與 2.1 一致）。**理由**：決策/驗證可不依 DB 完整單元測試；服務只負責讀寫與錯誤轉換。
- **決策**：簽核關卡以 `FormDefinition.isSignable` 區分；簽核類表單必須 APPROVED 才視為「齊備」，一般表單 SUBMITTED 即可。**理由**：符合 §8.2「簽核類表單具關卡與軌跡」；未簽核不該讓步驟過關。
- **決策**：跨步驟引用以 (sourceFormId, sourceKey) → targetKey 表達，只取 stepOrder 較小之已送出/核可填寫。**理由**：「前段產出帶往後續」語意明確，避免後步驟資料回欺。
- **決策**：`getStepCompletionGate` 作為公開服務方法提供，本輪**不**侵入修改 WorkflowService.advance。**理由**：保守。避免動到已綠的 2.1 引擎與模組依賴；串接點明確，列為下一步選項（見下方）。

## 開發者需知
- 本輪驗證：以 esbuild 將 `forms-engine.spec.ts` 轉譯後於 Node 跩過 jest-相容測試 25/25 全綠（沙筱無完整 prisma client，CI 的 Ubuntu 會正常跩 `jest`）；服務與模組亦以 esbuild bundle 確認 import/語法無誤。
- **串接點（下一步候選）**：WorkflowService.advanceCase 可在推進前呼叫 FormsService.getStepCompletionGate 做必填表單把關（需處理跨模組依賴，建議以參數注入避免循環）。
- 表單/步驟 CRUD 的 REST controller 尚未建立（屬後續）；現階段以 FormsService 方法為主要進入點。
- 2.4（#15 作業範本附檔）：schema 已有 `StepTemplate`（fileUrl/linkUrl/version）可直接依據。

## 待釐清（沿用，需求 §12）
- §12-1 跨角色移交是否需主管核可、流程一律由特定角色發起 → 設計器已留「觸發角色＋條件」欄位，實際核可關卡待釐清。
- §12-5 行事曆遞延規則（順延下一工作日/整體後推）→ 設計器已留 deferStrategy 選項，實際曆法來源待 4.1 實作。
