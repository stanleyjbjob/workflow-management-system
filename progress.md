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
| 2.3 | #14 表單與產出文件管理 | ✅ done | apps/api `forms/` 純引擎（驗證/簽核/必填把關/跨步驟引用） + FormsService、25 項 jest 單元測試 |
| 2.4 | #15 作業範本附檔 | ✅ done | apps/api `templates/` 純引擎（驗證/版本計算/最新版/歷史/下載解析） + TemplatesService、26 項 jest 單元測試 |
| 2.5 | #16 附件與連結管理（SharePoint/OneDrive）| ✅ done | apps/api `attachments/` 純引擎 + AttachmentsService、44 項 jest 單元測試 |
| 3.1 | #17 銷售流程 | ✅ done | 引擎(商機/紀錄/成案移交/失敗統計)+紀錄序列化 + 移交藍圖序列化(sales-handoff) + SalesService、引擎35+移交6 測試。REST/UI 屬後續 |
| 3.2 | #18 系統導入流程 | ✅ done | apps/api `onboarding/` 純引擎 + OnboardingService、26 項 jest 單元測試；handoffToEngineering 建立 ENVIRONMENT 案件。REST/UI 屬後續 |
| 3.3 | #19 環境建置流程 | ✅ done | apps/api `environment/` 純引擎(依銷售模式分支買斷/訂閱、接收導入移交、主機採購等待狀態、表單齊備+環境驗收把關、接收藍圖序列化)、55 項測試(sandbox 全綠 + tsc --strict 通過)；EnvironmentService(receiveFromOnboarding/recordHostProcurement+等待狀態 ON_HOLD/getHostReadiness/submitEnvironmentForm/getFormStatuses/completeEnvironment→COMPLETED)；app.module 註冊 EnvironmentModule。REST/UI 屬後續 |
| 3.4~6.x | #20-#30 | 待辦 | 依 WBS 順序 |

## 3.3 交付物（#19，環境建置流程，§6）
- `apps/api/src/environment/`：後端「環境建置流程」模組（對應需求規格 §6）。
  - `environment-engine.ts`：**純邏輯**（無 DB/Nest 相依，與 2.x/3.1/3.2 同風格）。
    - 步驟與表單（§6.2）：`EnvironmentStep` 四步驟（含 HOST_BUILD/TENANT_PROVISION 兩分支）、各表單 code 常數、`DEFAULT_ENVIRONMENT_STEPS` 預定義骨架。
    - 分支判斷（§6.1）：`resolveBranch`（PURCHASE→HOST、SUBSCRIPTION→TENANT、缺銷售模式→`sale_mode_required`）、`branchBuildFormCode`、`buildBranchSteps`。
    - 接收導入移交（§6.2 步驟1 / §3）：`intakeFromOnboardingHandoff`（與 onboarding 解耦，僅依結構 `EnvironmentHandoffLike`）→ `EnvironmentIntake`（帶 branch、去重產出引用）。
    - 主機採購等待狀態（§6.3）：`evaluateHostReadiness`（買斷未採購→waitingForHost、不可建置；採購後可建置；訂閱恆可）。
    - 表單齊備/驗收把關（§6.2 步驟2/3）：`unmetForms`、`planAcceptance`（買斷需主機已採購否則 `host_purchase_pending`、分支建置表單齊備否則 `branch_forms_incomplete`、驗收表完成否則 `acceptance_incomplete`）。
    - 接收藍圖持久化序列化：`ENVIRONMENT_INTAKE_FORM_CODE`、`serialize/deserializeEnvironmentIntake`（毀損拋 `intake_corrupt`）。
  - `environment-engine.spec.ts`：jest 單元測試 **55 項**（sandbox node 驗證全綠、tsc --strict 通過）。
  - `environment.service.ts`：`EnvironmentService`（Prisma + OnboardingService）：receiveFromOnboarding / recordHostProcurement(+等待狀態 ON_HOLD) / getHostReadiness / submitEnvironmentForm / getFormStatuses / completeEnvironment(→COMPLETED)。
  - `environment.module.ts` / `index.ts`：`EnvironmentModule`（imports PrismaModule + OnboardingModule）。
- `apps/api/src/app.module.ts`：註冊 `EnvironmentModule`。

## 技術決策（供 review）
- **決策**：沿用 2.x/3.1/3.2「純引擎 + Service」風格，引擎不依賴 DB 可被純函式測試。**理由**：一致、可測。
- **決策（3.3）**：environment-engine 與 onboarding 解耦（以結構型別 `EnvironmentHandoffLike` 接收移交藍圖）；服務層才呼叫 `OnboardingService.getEngineeringHandoff` 串接。**理由**：避免跨流程模組強耦合（與 3.2 對 sales 一致）。
- **決策（3.3）**：買斷「等待採購主機」以 append-only `ENVIRONMENT_HOST_PROCUREMENT` 表單紀錄 + 案件狀態 `ON_HOLD`/`IN_PROGRESS` 反映（§6.3）。**理由**：沿用既有 FormSubmission、不新增 migration；案件狀態讓專案管理(5.x)甘特圖可見等待。
- **決策（3.3）**：缺銷售模式時 `resolveBranch` 直接拋 `sale_mode_required`（不臆測分支）。**理由**：§6.1 買斷/訂閱走不同建置分支，銷售模式為必要前提；正常情況 saleMode 由銷售→導入→環境建置一路帶往。
- **決策（3.3）**：環境驗收以「驗收表齊備」認定，未強制簽核（`ENV_SIGNABLE_FORM_CODES`=空，保留介面）。**理由**：§6 未明定強制簽核關卡（§12-4 待釐清）。
- （沿用 3.2）表單與藍圖以既有 `FormSubmission` append-only 落地、固定 code 的 FormDefinition 容器（resolve-or-create），不新增 migration。

## 未完成 / Handoff（下一輪或人類接手）
1. ✅（3.1）拜訪/會議紀錄 + 成案移交藍圖持久化落地（getHandoff 可取回）。
2. ✅（3.2）系統導入流程引擎 + 服務落地：接收銷售移交、預定義時間點/提醒、委任權限表簽核把關、**移交工程建立 ENVIRONMENT 案件**。
3. ✅（3.3）環境建置流程引擎 + 服務落地：依銷售模式分支、接收導入移交、主機採購等待狀態、環境驗收把關→COMPLETED。
4. **CI 全流程驗證**：3.3 引擎 + spec 已於 sandbox 驗證（55 測試綠 + tsc --strict）；`environment.service.ts` 以 stub（PrismaService/OnboardingService/@nestjs/common）通過 strict typecheck，惟未在真實 monorepo 跑 `pnpm -r build`（需 generated Prisma client）。下輪/人類 review 時請確認 CI build 綠。
5. **客製化（需求變更）流程（3.4 #20）**：可接續——上線後客戶需求觸發；顧問發起→工程主管指派→工程師開發→顧問複測→測試區→正式區（§7，含複測不通過退回循環）。
6. **提醒派送（4.2）/ 曆法遞延（4.1）**：onboarding `dueReminders` 已算出需提醒清單、`buildSchedule` 已留 `isExcluded` 介面；環境建置時程提醒亦可沿用。實際通知管道（§12-7）與國定假日來源（§12-5）待 4.x。
7. **REST controller / 前端 UI**：sales / onboarding / environment 皆尚未提供（屬後續 API 層任務）。
8. **服務層整合測試**：sales/onboarding/environment service 目前僅引擎層純函式測試覆蓋；DB 行為待後續以整合測試補強。

## 待釐清（沿用，需求 §12）
- §12-1 跨角色移交是否需主管核可、流程一律由特定角色發起 → 設計器已留「觸發角色＋條件」欄位，實際核可關卡待釐清。
- §12-2 失敗原因分類項目（供改善分析報表）→ 影響 3.1 失敗分類 Enum 收斂，目前以可擴充字串承載。
- §12-3 各表單實際欄位（報價單/客製需求/委任權限表/人員資料表/環境建置檢核表等）→ 目前僅以 code 標識容器、data 承載 JSON。
- §12-4 各表單簽核關卡與層級 → 影響環境驗收是否需顧問簽核（3.3 目前未強制，保留簽核集合介面）。
- §12-5 行事曆遞延規則（順延下一工作日/整體後推）→ onboarding `buildSchedule` 已留 `isExcluded`，曆法來源待 4.1。
- §12-7 提醒管道（系統內/Email/其他）→ 影響 4.2 與 onboarding `dueReminders` 派送。
- §12-10 附件/範本實體儲存於系統或改以 SharePoint/OneDrive 連結為主、允許檔案類型與大小上限 → 影響 2.4/2.5 上傳實作，待主管確認。
