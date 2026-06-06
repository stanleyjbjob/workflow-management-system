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
| 2.3 | #14 表單與產出文件管理 | ✅ done | apps/api `forms/` 純引擎（驗證/簽核/必填把關/跨步驟引用）+ FormsService、25 項 jest 單元測試 |
| 2.4 | #15 作業範本附檔 | ✅ done | apps/api `templates/` 純引擎（驗證/版本計算/最新版/歷史/下載解析）+ TemplatesService、26 項 jest 單元測試 |
| 2.5 | #16 附件與連結管理（SharePoint/OneDrive）| ✅ done | apps/api `attachments/` 純引擎 + AttachmentsService、44 項 jest 單元測試 |
| 3.1 | #17 銷售流程 | ✅ done | 引擎(商機/紀錄/成案移交/失敗統計)+紀錄序列化 + 移交藍圖序列化(sales-handoff) + SalesService(拜訪紀錄 + 成案移交 append-only 持久化 + getHandoff)、引擎35+移交6 測試。REST/UI 屬後續 API 層任務 |
| 3.2 | #18 系統導入流程 | ✅ done | apps/api `onboarding/` 純引擎(接收銷售移交/預定義時間點排程/主動提醒/表單齊備+委任權限表簽核把關/移交工程→ENVIRONMENT 藍圖+序列化)、26 項 jest 單元測試；OnboardingService(receiveFromSales/createOnboardingCase/submit+sign 表單/getFormStatuses/handoffToEngineering 建立 ENVIRONMENT 案件)；app.module 註冊 OnboardingModule 與（先前遺漏的）SalesModule。REST/UI 屬後續 |
| 3.3~6.x | #19-#30 | 待辦 | 依 WBS 順序 |

## 3.2 交付物（#18，系統導入流程，§5）
- `apps/api/src/onboarding/`：後端「系統導入流程」模組（對應需求規格 §5）。
  - `onboarding-engine.ts`：**純邏輯**（無 DB/Nest 相依，與 2.x/3.1 同風格）。
    - 步驟與表單（§5.2）：`OnboardingStep` 五步驟、各表單 code 常數（導入計畫表/啟動會議記錄/人員資料表/委任權限表/移交清單）、`DEFAULT_ONBOARDING_STEPS` 預定義骨架（§5.1 部門可自訂）。
    - 接收銷售移交（§5.2 步驟1 / §4.6）：`intakeFromSalesHandoff`（與 sales 解耦，僅依結構）→ `OnboardingIntake`（去重產出引用）；無定版報價單拋 `no_final_quote_in_intake`。
    - 預定義時間點與提醒（§5.1、§5.3）：`buildSchedule`（錨點＋offset→絕對日，注入 `isExcluded` predicate 供連假/排除日遞延，曆法來源待 4.1）、`dueReminders`（逾期＋lookahead 內到期、排除已完成步驟）。
    - 表單齊備/簽核把關（§5.2 步驟4、§5.3）：`unmetForms`（一般表單 SUBMITTED 即齊備、簽核表單需 APPROVED）、`isAuthDelegationSigned`（委任權限表須簽核）。
    - 移交工程（§5.2 步驟5、§3）：`planEngineeringHandoff` 把關（啟動會議完成＋必填齊備＋委任權限表已簽核）→ `EnvironmentCaseBlueprint`（flowType=ENVIRONMENT、帶往產出引用＋saleMode）；未過拋 `kickoff_incomplete`/`required_forms_incomplete`/`auth_delegation_unsigned`。
    - 移交藍圖持久化序列化：`ONBOARDING_HANDOFF_FORM_CODE`、`serialize/deserializeEnvironmentBlueprint`（毀損拋 `handoff_corrupt`）。
  - `onboarding-engine.spec.ts`：jest 單元測試 **26 項**（sandbox node 驗證全綠、tsc --strict 通過）。
  - `onboarding.service.ts`：`OnboardingService`（Prisma）：
    - `receiveFromSales`：呼叫 `SalesService.getHandoff` 取回成案移交 → intake（串接 3.1 留下的 handoff）。
    - `createOnboardingCase`：建 ONBOARDING 案件；若帶 salesCaseId，接收移交並把 intake 以 append-only FormSubmission（code=`ONBOARDING_INTAKE`）落地。
    - `submitOnboardingForm`/`signOnboardingForm`/`getFormStatuses`：各時間點表單填寫＋委任權限表簽核（append-only，沿用 forms 持久化）。
    - `handoffToEngineering`：把關通過後**建立後續 ENVIRONMENT 案件**並落地移交藍圖；`getEngineeringHandoff` 可取回。
  - `onboarding.module.ts` / `index.ts`：`OnboardingModule`（imports PrismaModule + SalesModule）。
- `apps/api/src/app.module.ts`：註冊 `OnboardingModule`；並補上**先前遺漏未註冊的 `SalesModule`**（3.1 progress 誤記為已註冊，實際 app.module 未 import）。

## 技術決策（供 review）
- **決策**：沿用 2.x/3.1「純引擎 + Service」風格，引擎不依賴 DB 可被純函式測試。**理由**：一致、可測。
- **決策（3.2）**：onboarding-engine 與 sales 模組「解耦」——以結構型別 `SalesHandoffLike` 接收移交，不 import sales 型別。**理由**：避免跨流程模組強耦合；服務層才實際呼叫 `SalesService.getHandoff` 串接。**權衡**：型別非編譯期強保證，靠服務層轉接。
- **決策（3.2）**：行事曆遞延以注入 `isExcluded(date)` predicate 表達，預設不遞延。**理由**：實際國定假日/連假曆法屬 4.1，先留介面、不臆測曆法來源（§12-5 待釐清）。
- **決策（3.2）**：委任權限表（`ONBOARDING_AUTH_DELEGATION`）標為簽核表單，移交工程前必須 APPROVED；僅缺此項時回更精確的 `auth_delegation_unsigned`。**理由**：對應 §5.3「委任權限表需簽核」與 ISO §11.2 存取控制簽核軌跡。
- **決策（3.2）**：表單與移交藍圖沿用既有 `FormSubmission` append-only 落地（固定 code 的 FormDefinition 容器，resolve-or-create），不新增 migration。**理由**：與 3.1 一致；避免在 §12-3 表單欄位未定前新增資料表。**權衡**：未來若需結構化查詢表單欄位，可再評估獨立資料表。
- **決策（3.2）**：`handoffToEngineering` 需呼叫端提供 `envWorkflowId`（ENVIRONMENT 的 WorkflowDefinition）。**理由**：ENVIRONMENT 流程定義屬 6.x/3.3；此處僅建立案件實體並連結，不臆測流程內容。

## 未完成 / Handoff（下一輪或人類接手）
1. ✅（3.1）拜訪/會議紀錄 + 成案移交藍圖持久化落地（getHandoff 可取回）。
2. ✅（3.2）系統導入流程引擎 + 服務落地：接收銷售移交、預定義時間點/提醒、委任權限表簽核把關、**移交工程建立 ENVIRONMENT 案件**。
3. **CI 全流程驗證**：引擎已於 sandbox 驗證（26 測試綠 + tsc --strict）；OnboardingService 以 stub 通過 strict typecheck，惟未在真實 monorepo 跑 `pnpm -r build`（需 generated Prisma client）。下輪/人類 review 時請確認 CI build 綠。
4. **環境建置流程（3.3 #19）**：可直接接續——`OnboardingService.handoffToEngineering` 已建立 ENVIRONMENT 案件並帶往產出引用與 saleMode；3.3 據此實作買斷(主機)/訂閱(租戶)分支（§6）。
5. **提醒派送（4.2）/ 曆法遞延（4.1）**：`dueReminders` 已算出需提醒清單、`buildSchedule` 已留 `isExcluded` 介面；實際通知管道（系統內/Email，§12-7）與國定假日來源（§12-5）待 4.x。
6. **REST controller / 前端 UI**：sales 與 onboarding 皆尚未提供（屬後續 API 層任務）。
7. **服務層整合測試**：onboarding/sales service 目前僅引擎層純函式測試覆蓋；DB 行為待後續以整合測試補強（本 repo 目前無 Prisma 整合測試）。

## 待釐清（沿用，需求 §12）
- §12-1 跨角色移交是否需主管核可、流程一律由特定角色發起 → 設計器已留「觸發角色＋條件」欄位，實際核可關卡待釐清。
- §12-2 失敗原因分類項目（供改善分析報表）→ 影響 3.1 失敗分類 Enum 收斂，目前以可擴充字串承載。
- §12-3 各表單實際欄位（報價單/客製需求/委任權限表/人員資料表等）→ 影響 onboarding 表單欄位定義，目前僅以 code 標識容器、data 承載 JSON。
- §12-5 行事曆遞延規則（順延下一工作日/整體後推）→ onboarding `buildSchedule` 已留 `isExcluded`，曆法來源待 4.1。
- §12-7 提醒管道（系統內/Email/其他）→ 影響 4.2 與 onboarding `dueReminders` 派送。
- §12-10 附件/範本實體儲存於系統或改以 SharePoint/OneDrive 連結為主、允許檔案類型與大小上限 → 影響 2.4/2.5 上傳實作，待主管確認。
