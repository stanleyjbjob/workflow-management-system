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
| 3.4 | #20 客製化（需求變更）流程 | ✅ done | apps/api `customization/` 純引擎(指派鏈把關/狀態機/複測退回循環/測試區→正式區兩道關卡/需求變更單序列化)、40 項測試(sandbox 全綠 + tsc --strict 通過)；CustomizationService(raiseChangeRequest/assignEngLead/assignEngineer/submitForm/submitForRetest/recordRetest/confirmTestDeploy/confirmProdDeploy + append-only 狀態事件持久化)；app.module 註冊 CustomizationModule。REST/UI 屬後續 |
| 4.1 | #21 行事曆判斷：假日/連假遞延 | ✅ done | apps/api `calendar/` 純引擎(工作日判斷/遞延/重算) + CalendarService。詳見既有 commit |
| 4.2 | #22 提醒與通知 | ✅ done | apps/api `reminders/` 引擎 + RemindersService。詳見既有 commit |
| 5.1 | #23 專案 CRUD 與流程串接 | ✅ done | apps/api `projects/` project-engine + ProjectService |
| 5.2 | #24 甘特圖與進度呈現 | ✅ done | gantt-engine + GanttService |
| 5.3 | #25 延遲/超前計算 | ✅ done | delay-engine + DelayService |
| 5.4 | #26 專案行事曆排除日 | ✅ done | exclusion-engine/exclusion-conflict + ExclusionService |
| 5.5 | #27 簡報模式 | ✅ done | 詳見既有 commit |
| 5.6 | #28 專案↔案件雙向導覽 | ✅ done | 詳見既有 commit |
| 6.1 | #29 任務看板與待辦 | 🔄 進行中 | apps/api `kanban/` 純引擎(分欄/到期·逾期·遞延標示/KPI/角色過濾) + KanbanService、43 項測試(sandbox 全綠 + tsc --strict 通過)；app.module 註冊 KanbanModule。**REST controller / 前端看板 UI / 待填表單統計 屬後續**（見下） |
| 6.2 | #30 ISO 27001 文件化軌跡 | 待辦 | 依 WBS 順序 |

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

## 3.4 交付物（#20，客製化（需求變更）流程，§7）
- `apps/api/src/customization/`：後端「客製化（需求變更）流程」模組（對應需求規格 §7）。
  - `customization-engine.ts`：**純邏輯**（無 DB/Nest 相依，與 2.x/3.1/3.2/3.3 同風格）。
    - 步驟與表單（§7.2）：`CustomizationStep` 八步驟、各表單 code 常數（需求變更單/開發任務單/開發紀錄/測試文件/複測報告/測試區更新紀錄/正式區上線紀錄）、`DEFAULT_CUSTOMIZATION_STEPS` 預定義骨架。
    - 狀態機（§7 指派鏈＋退回循環＋兩道關卡）：`CustomizationState`(8 態)/`CustomizationAction`(8 動作)/`TRANSITIONS` 轉移表、`nextState`/`canTransition`/`isReturnAction`。關鍵：`RETEST_FAIL` 由 IN_RETEST 回到 IN_DEVELOPMENT 形成複測退回循環。
    - 指派鏈把關（§7.2 步驟2/3）：`planAssignLead`(期望 ENG_LEAD)/`planAssignEngineer`(期望 ENGINEER)，比對被指派人角色(roleMatches；未提供＝null 未驗證，不強制 §12-1)。
    - 送交複測把關（§7.2 步驟4/5）：`planSubmitForRetest` 需開發紀錄＋測試文件齊備否則 `forms_incomplete`。
    - 複測退回循環（§7.3）：`applyRetestResult`(僅 IN_RETEST；通過→DEPLOYING_TEST、不通過→IN_DEVELOPMENT 並退回次數+1)。
    - 兩道關卡（§7.2 步驟7/8、§7.3）：`planTestDeployment`(非 DEPLOYING_TEST→`retest_not_passed`、測試區紀錄未齊→`forms_incomplete`)、`planProductionDeployment`(非 DEPLOYING_PROD→`test_deploy_pending`、正式區紀錄未齊→`forms_incomplete`)；測試區/正式區為不同表單代碼分別記錄。
    - 需求變更單持久化：`buildChangeRequest`(clientName/title 必填否則 `request_invalid`、carriedDocRefIds 去重)、`serialize/deserializeChangeRequest`(毀損拋 `request_corrupt`)。
  - `customization-engine.spec.ts`：jest 單元測試 **40 項**（sandbox node 驗證全綠、tsc --strict 通過）。
  - `customization.service.ts`：`CustomizationService`（Prisma）：raiseChangeRequest / getChangeRequest / assignEngLead / assignEngineer / submitForm / getFormStatuses / submitForRetest / recordRetest / confirmTestDeploy / confirmProdDeploy / getState / getReturnCount。流程狀態以 append-only `CUSTOMIZATION_STATE` 狀態事件表單持久化（讀最近一筆還原、統計 returned 退回次數）；案件 status 反映 IN_PROGRESS/COMPLETED。
  - `customization.module.ts` / `index.ts`：`CustomizationModule`（imports PrismaModule）。
- `apps/api/src/app.module.ts`：註冊 `CustomizationModule`。

## 6.1 交付物（#29，任務看板與待辦，§8）
- `apps/api/src/kanban/`：後端「任務看板與待辦」模組（對應需求規格 §8、原型「流程看板/待辦」）。
  - `kanban-engine.ts`：**純邏輯**（無 DB/Nest 相依，與 2.x~5.x 同風格）。
    - 一張任務卡＝一筆步驟實例（StepInstance）。`KanbanTaskInput` 以結構型別解耦 Prisma。
    - 分欄（互斥）`columnOf`：COMPLETED→`DONE`；actionable 且即將到期→`UPCOMING`；IN_PROGRESS→`IN_PROGRESS`；PENDING→`TODO`。`KANBAN_COLUMN_ORDER`/`KANBAN_COLUMN_LABELS`（待辦/進行中/即將到期/已完成）。
    - 到期標示 `classifyDue`：OVERDUE(逾期)/UPCOMING(即將到期，0..N 曆日內未逾期)/NONE；`DEFAULT_UPCOMING_WITHIN_DAYS=3`（UTC 日界）。逾期任務留在原狀態欄並以 `overdue` marker 呈現。
    - 遞延標示：與行事曆解耦（同 delay-engine 注入策略）。引擎接受每卡 `deferred/deferredDays` 或注入 `deferralResolver`；`resolveTaskDeferral` 決定最終值。
    - 過濾 `matchesFilter`/`roleMatches`/`isMine`：依角色(responsibleRoleCode)/承辦人/流程型別/僅與我相關；主管綜覽全部。
    - KPI `summarizeKpi`：待處理(actionable 數)/即將到期/逾期/遞延。`buildBoard` 產出 `{ order, columns, kpi, total, activeTotal }`，SKIPPED/RETURNED 不上看板。
  - `kanban-engine.spec.ts`：jest 單元測試 **43 項**（sandbox node 驗證全綠 + tsc --strict 通過）。
  - `kanban.service.ts`：`KanbanService.getBoard(user, filter?, options?)`：以 `AccessScopeService.caseWhere` 收斂可見範圍（§8.5）、讀 StepInstance(含 Case / StepDefinition.responsibleRole)、以 `CalendarService` 建 `deferralResolver`(到期日落非工作日→遞延，天數＝到下一工作日曆日差) 餵入引擎。service+module 以 stub 通過 tsc --strict。
  - `kanban.module.ts`(imports PrismaModule + RbacModule + CalendarModule) / `index.ts`。
- `apps/api/src/app.module.ts`：註冊 `KanbanModule`。
- commit：`e56ca98`（engine/module/index）、`6338bb8`（spec/service/app.module）。

## 技術決策（供 review）
- **決策**：沿用 2.x/3.1/3.2「純引擎 + Service」風格，引擎不依賴 DB 可被純函式測試。**理由**：一致、可測。
- **決策（3.3）**：environment-engine 與 onboarding 解耦（以結構型別 `EnvironmentHandoffLike` 接收移交藍圖）；服務層才呼叫 `OnboardingService.getEngineeringHandoff` 串接。**理由**：避免跨流程模組強耦合（與 3.2 對 sales 一致）。
- **決策（3.3）**：買斷「等待採購主機」以 append-only `ENVIRONMENT_HOST_PROCUREMENT` 表單紀錄 + 案件狀態 `ON_HOLD`/`IN_PROGRESS` 反映（§6.3）。**理由**：沿用既有 FormSubmission、不新增 migration；案件狀態讓專案管理(5.x)甘特圖可見等待。
- **決策（3.3）**：缺銷售模式時 `resolveBranch` 直接拋 `sale_mode_required`（不臆測分支）。**理由**：§6.1 買斷/訂閱走不同建置分支，銷售模式為必要前提；正常情況 saleMode 由銷售→導入→環境建置一路帶往。
- **決策（3.3）**：環境驗收以「驗收表齊備」認定，未強制簽核（`ENV_SIGNABLE_FORM_CODES`=空，保留介面）。**理由**：§6 未明定強制簽核關卡（§12-4 待釐清）。
- （沿用 3.2）表單與藍圖以既有 `FormSubmission` append-only 落地、固定 code 的 FormDefinition 容器（resolve-or-create），不新增 migration。
- **決策（3.4）**：客製化流程狀態（CustomizationState）以 append-only `CUSTOMIZATION_STATE` 狀態事件表單持久化（讀最近一筆還原、依 returned 統計退回次數），不在 Case 上新增欄位、不新增 migration。**理由**：沿用 3.3「以 FormSubmission 落地流程資訊」風格；退回循環的歷史軌跡（§8.4 永久留存）天然落在事件日誌中，亦符合 §11 ISO 文件化軌跡。
- **決策（3.4）**：流程狀態機（CustomizationState）與 schema `CaseStatus` 解耦——前者描述「流程進到哪一步」（8 態，含退回），後者反映案件生命週期（IN_PROGRESS/COMPLETED）供 5.x 甘特圖。**理由**：§7 步驟細緻且含循環，硬塞進 CaseStatus 會失真。
- **決策（3.4）**：指派鏈角色（顧問/工程主管/工程師）以引擎 `planAssign*` 比對被指派人角色但**不強制**（roleMatches 僅回報，null＝未提供）。**理由**：§12-1 跨角色移交是否需核可未定，先回報不阻擋；服務層以 RBAC/Case.assigneeId 落地。
- **決策（3.4）**：服務層操作既有 CUSTOMIZATION 案件（caseId 由呼叫端提供），不在此建立 Case/WorkflowDefinition。**理由**：與 3.3 一致；流程定義由 8.x/設計器產生。
- **決策（6.1）**：看板分欄互斥，逾期任務不移入「即將到期」欄而以 `overdue` marker 留在原狀態欄。**理由**：「即將到期」literally＝接近到期（不含逾期），與 KPI 將「即將到期」「逾期」分開計一致。可調（`columnOf`）。
- **決策（6.1）**：遞延標示沿用 4.1 calendar-engine（到期日落非工作日→遞延），與引擎解耦（注入 `deferralResolver`）。**理由**：與 delay-engine 注入 workdayCounter 一致；農曆連假/補班來源 §12-5 定案後帶入 custom 行事曆即生效。

## 未完成 / Handoff（下一輪或人類接手）
1. ✅（3.1）拜訪/會議紀錄 + 成案移交藍圖持久化落地（getHandoff 可取回）。
2. ✅（3.2）系統導入流程引擎 + 服務落地：接收銷售移交、預定義時間點/提醒、委任權限表簽核把關、**移交工程建立 ENVIRONMENT 案件**。
3. ✅（3.3）環境建置流程引擎 + 服務落地：依銷售模式分支、接收導入移交、主機採購等待狀態、環境驗收把關→COMPLETED。
4. **CI 全流程驗證**：各純引擎 + spec 已於 sandbox 驗證綠燈 + tsc --strict；service 多以 stub 通過 strict typecheck，惟未在真實 monorepo 跑 `pnpm -r build`（需 generated Prisma client）。請於 review 時確認 CI build 綠。
5. ✅（3.4）客製化（需求變更）流程引擎 + 服務落地。
6. **提醒派送（4.2）/ 曆法遞延（4.1）**：已落地引擎；國定假日/連假/補班來源（§12-5）與通知管道（§12-7）仍待主管定案後接上實際資料來源。
7. **REST controller / 前端 UI**：sales / onboarding / environment / customization / **kanban(6.1)** 皆尚未提供 controller / 前端（屬後續 API/UI 層任務）。
8. **服務層整合測試**：各 service 目前僅引擎層純函式測試覆蓋；DB 行為待後續以整合測試補強。
9. **（6.1，本輪）任務看板**：kanban 純引擎 + KanbanService 已落地並註冊 KanbanModule（43 測試綠）。**下一步**：(a) `kanban.controller.ts` 暴露 `GET /kanban`(role/assignee/flowType/onlyMine 過濾，`case:read` 守衛、注入 SessionUser)；(b) `apps/web` 看板 UI（四欄+KPI+到期/逾期/遞延標示+角色過濾+點卡開案件，對應原型）；(c) 接 FormsModule 統計各步驟「待填表單數」填入 `pendingRequiredForms`(目前 0)；(d) 確認真實 monorepo build/test 綠；(e) §12-5 假日來源定案後於 `KanbanService.buildDeferralResolver` 帶入 custom 行事曆。下一個可動工：6.2 ISO 27001 文件化軌跡（#30）。

## 待釐清（沿用，需求 §12）
- §12-1 跨角色移交是否需主管核可、流程一律由特定角色發起 → 設計器已留「觸發角色＋條件」欄位，實際核可關卡待釐清（3.4 指派鏈已留 roleMatches 回報、未強制）。
- §12-2 失敗原因分類項目（供改善分析報表）→ 影響 3.1 失敗分類 Enum 收斂，目前以可擴充字串承載。
- §12-3 各表單實際欄位（報價單/客製需求/委任權限表/人員資料表/環境建置檢核表等）→ 目前僅以 code 標識容器、data 承載 JSON。
- §12-4 各表單簽核關卡與層級 → 影響環境驗收/客製化複測是否需簽核（3.3/3.4 目前未強制，保留簽核集合介面）。
- §12-5 行事曆遞延規則（順延下一工作日/整體後推）與國定假日/連假/補班來源 → calendar-engine 已實作兩種模式與遞延；6.1 看板遞延標示沿用之，假日來源待定案。
- §12-7 提醒管道（系統內/Email/其他）→ 影響 4.2 與 onboarding `dueReminders` 派送。
- §12-10 附件/範本實體儲存於系統或改以 SharePoint/OneDrive 連結為主、允許檔案類型與大小上限 → 影響 2.4/2.5 上傳實作，待主管確認。
