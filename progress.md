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
| 4.1 | #21 行事曆判斷：假日/連假遞延 | ✅ done | apps/api `calendar/` 純引擎(假日/週末/補班判斷、遞延、工作日運算、兩種遞延模式重算)+CalendarService(專案排除日 §10.5)、45 項斷言全綠 + tsc --strict 通過 |
| 4.2 | #22 提醒與通知 | ✅ done | apps/api `reminders/` 純引擎(提前/到期/逾期多時點、提醒日由「已遞延到期日」推導故遞延同步調整、多管道 IN_APP/EMAIL/OTHER 可插拔 dispatcher、跨輪去重、派送日誌序列化)、21 案/53 斷言全綠 + tsc --strict 通過；ReminderService(由 StepInstance 組對象→行事曆遞延→挑應派送→IN_APP 落地 NOTIFICATION_INBOX + 去重日誌 NOTIFICATION_DISPATCH_LOG)；app.module 註冊 RemindersModule。REST/UI 與 Email/其他管道 dispatcher 屬後續 |
| 5.1 | #23 專案 CRUD 與流程串接 | ✅ done | apps/api `projects/` 純引擎(輸入驗證/PRJ-YYYYMM-#### 代碼/專案狀態機/掛載視窗驗證允許先後與重疊/步驟完成比例+整體進度計算)、30 案測試(sandbox node 全綠 + tsc --strict、--noUnusedLocals 通過)；ProjectService(createProject/getProject/listProjects/updateProject/changeStatus/deleteProject/mountFlow/updateFlowWindow/unmountFlow/refreshFlowProgress/getProjectDetail 向下查看步驟與負責人)；app.module 註冊 ProjectsModule。沿用既有 Project/ProjectFlow/Exclusion schema 不新增 migration。REST/UI 屬後續 |
| 5.2 | #24 甘特圖與進度呈現 | ✅ done | apps/api `projects/gantt-engine.ts` 純引擎(時間軸範圍/月份刻度/各流程長條+完成填色 fillRatio/今日基準線+inRange/§4.2 預期進度/§4.3 狀態 delta+容許門檻 T/排除日網底/KPI 整體進度·延遲·超前·排除日區間數)、**27 案測試**(sandbox node 全綠 + tsc --strict、--noUnusedLocals/Parameters 通過)；GanttService(getProjectGantt / getProjectGanttFresh 先回寫步驟比例再產生)；projects.module 註冊並 export GanttService。沿用既有 schema 不新增 migration。REST/UI 屬後續 |
| 5.3 | #25 延遲／超前計算 | ✅ done | apps/api `projects/` delay-engine 純引擎(重用 5.2 expectedProgress/classifyFlowStatus 判五態 + 差異百分比→差異天數換算、日曆日/工作日基準可選、依流程型別覆寫容許門檻 T、完成/未開始差異天數歸零)、**22 案測試**(sandbox tsc --strict + node 全綠)；DelayService(getProjectDelays/getProjectDelaysFresh，WORKDAY 基準經 CalendarService.buildCalendar + businessDaysBetween 注入)；projects.module 註冊 DelayService(imports CalendarModule)。沿用既有 schema 不新增 migration。REST/UI 屬後續 |
| 5.4~6.2 | #26-#30 | 待辦 | 依 WBS 順序 |

## 5.3 交付物（#25，延遲／超前計算，規格 §4.2–§4.4 / §5.1 狀態清單）
- `apps/api/src/projects/delay-engine.ts`：延遲／超前**純邏輯**（無 DB/Nest/Prisma/CalendarService 相依，日界一律 UTC，與 5.2 同風格）。
  - 五態判斷：直接 import 5.2 gantt-engine 的 `expectedProgress`(§4.2 線性預期) 與 `classifyFlowStatus`(§4.3 delta 與門檻 T)，確保延遲清單與甘特圖膠囊**完全一致**。
  - 依流程型別門檻：`FlowTypeThresholdConfig`(default + byFlowType)、`resolveThreshold(flowType, cfg|number)`；數字＝統一門檻、物件＝可依流程型別覆寫(§9-2)。`DEFAULT_FLOWTYPE_THRESHOLDS`=沿用 5.2 的 ±8。
  - 差異天數換算：`evaluateFlowDelay(input, options)`→`DelayEvaluation`(expected/actual/deltaPercent/status/thresholdUsed/basis/durationDays/deltaDays/delayDays/aheadDays)。deltaDays = round(deltaPercent/100 × 計畫工期)，符號同 deltaPercent(正＝超前/負＝落後)；**完成與未開始一律歸零**避免誤計。
  - 基準可選(§9-3)：`DayBasis`=CALENDAR(日曆日，工期=planEnd−planStart 天，至少 1)/WORKDAY(工期由注入 `WorkdayCounter` 計，扣假日週末)；WORKDAY 未提供 counter 拋 `workday_counter_required`。
  - 批次與彙總：`evaluateFlows(flows, options)`、`summarizeDelays(evals)`→`DelaySummary`(五態計數 + maxDelayDays/maxAheadDays/netDeltaDays)，供狀態清單/KPI。
  - 錯誤：`DelayEngineError`(invalid_date/invalid_range/invalid_threshold/workday_counter_required)。
- `apps/api/src/projects/delay-engine.spec.ts`：jest 單元測試 **22 案**(sandbox 以 tsc CommonJS + node 跑全綠；引擎另過 tsc --strict + --noUnusedLocals/--noUnusedParameters)。涵蓋 resolveThreshold(預設/統一/依型別覆寫/負門檻錯誤)、五態判斷(含 ±T 邊界、依型別門檻改變狀態)、天數換算(日曆/工作日/未提供 counter/完成未開始歸零/零工期)、差異百分比正確、批次+彙總、錯誤處理。
- `apps/api/src/projects/delay.service.ts`：`DelayService`(Prisma + ProjectService + CalendarService)：`getProjectDelays(projectId, {now?, thresholds?, basis?, custom?})`(讀 Project + flows → evaluateFlows + summarizeDelays → `ProjectDelayReport`)、`getProjectDelaysFresh`(先對有 caseId 的流程 refreshFlowProgress 回寫步驟比例，再計算)。WORKDAY 基準以 `CalendarService.buildCalendar(custom)` + `businessDaysBetween` 建 workdayCounter。
- `apps/api/src/projects/projects.module.ts` / `index.ts`：`imports: [PrismaModule, CalendarModule]`、註冊並 export `DelayService`、匯出 delay-engine / delay.service。
- **決策（5.3）**：差異天數以「進度落差 × 工期」換算，而非「今日 vs 預期達標日」的日曆位移。**理由**：直接由 §4.2/§4.3 既有 deltaPercent 推導、與 5.2 狀態判斷同源可純函式測試；完成/未開始歸零避免完成流程被誤報「超前 N 天」。
- **決策（5.3）**：容許門檻支援依流程型別覆寫(§9-2 未定案前 default=8)、天數基準 CALENDAR/WORKDAY 皆實作(§9-3 未定案前預設 CALENDAR)。**理由**：沿用既有「保留介面/可設定、不硬編業務規則」風格(如 4.1 DeferralMode、4.2 dispatcher)；主管定案後切換選項即可，不需改引擎。
- **決策（5.3）**：delay-engine 與 CalendarService 解耦——工作日工期以 `WorkdayCounter` 函式注入，引擎不 import 行事曆。**理由**：維持純函式可測性與跨模組解耦(與 reminder-engine 一致)；服務層才接 CalendarService。

## 5.2 交付物（#24，甘特圖與進度呈現，規格 §5.2 / §5.1 KPI / §10.3）
- `apps/api/src/projects/gantt-engine.ts`：甘特圖**純邏輯**（無 DB/Nest/Prisma 相依，日界一律 UTC，與 2.x/3.x/4.x/5.1 同風格）。
  - 幾何工具：`toIsoDate`(UTC YYYY-MM-DD)、`ratioOf(date, axisStart, axisEnd)`(某日於軸上 0..1 位置，含端點，零跨距時 date<start→0 否則 1)。
  - 時間軸：軸範圍 = min(專案 planStart, 所有流程 planStart) .. max(專案 planEnd, 所有流程 planEnd)，確保長條與今日線落在軸內；`buildMonthTicks`(每月第一天 UTC 的月份刻度，守門 1200 月)；`totalDaysInclusive`(含端點天數，至少 1)。
  - 預期進度（§4.2）：`expectedProgress(planStart, planEnd, now)`→線性 clamp 0..100(未開始 0／結束後 100／零工期 now>=end→100)。
  - 狀態分類（§4.3）：`classifyFlowStatus`→`{status, delta}`，優先序 progress>=100→COMPLETED、now<planStart→NOT_STARTED、否則 delta=實際−預期 與容許門檻 T 判 DELAYED/AHEAD/ON_TIME(±T 含端點)。`DEFAULT_TOLERANCE_THRESHOLD=8`(§9-2 待主管定案)。
  - 主函式 `buildGantt(params)`→`GanttView`：`axis`(start/end/totalDays/months[])、`today`(date/ratio/inRange，超出軸範圍夾擠且 inRange=false)、`rows[]`(每流程 startRatio/endRatio/progress/fillRatio=progress÷100/expected/delta/status，透傳 caseId/flowType 供 5.6 雙向導覽)、`exclusions[]`(每排除日 startRatio/endRatio 網底 + reason/source)、`kpis`(overallProgress 各流程平均、delayedCount/aheadCount/onTimeCount/completedCount/notStartedCount、exclusionRangeCount)。
  - 錯誤：`GanttEngineError`(invalid_date/invalid_range/invalid_threshold)。
- `apps/api/src/projects/gantt-engine.spec.ts`：jest 單元測試 **27 案**(sandbox 以 tsc CommonJS + node 跑全綠；引擎另過 tsc --strict + --noUnusedLocals/--noUnusedParameters)。涵蓋 ratioOf 端點/夾擠/零跨距、expectedProgress 線性與零工期、狀態分類五態與邊界、月份刻度跨年、buildGantt 整合(軸涵蓋/今日線位置/長條端點/狀態/KPI/排除日網底/軸自動延展/無流程)、錯誤處理。
- `apps/api/src/projects/gantt.service.ts`：`GanttService`(Prisma + ProjectService)：`getProjectGantt(projectId, {now?, toleranceThreshold?})`(讀 Project + flows + exclusions → buildGantt)、`getProjectGanttFresh`(先對有 caseId 的流程 `refreshFlowProgress` 回寫步驟比例，再產生甘特圖，反映最新完成度 §6.2)。
- `apps/api/src/projects/projects.module.ts` / `index.ts`：註冊並 export `GanttService`、匯出 gantt-engine / gantt.service。

## 5.1 交付物（#23，專案 CRUD 與流程串接，§3/§5.1/§6.1）
- `apps/api/src/projects/`：後端「專案管理」模組（對應專案管理模組規格 §3、§5.1、§6.1）。
  - `project-engine.ts`：**純邏輯**（無 DB/Nest 相依，日界一律 UTC，與 2.x/3.x/4.x 同風格）。
    - 專案代碼：`generateProjectCode({now,sequence})`→`PRJ-YYYYMM-####`（序號補零 4 位；sequence 非正整數拋 `invalid_sequence`）。
    - 輸入驗證：`buildProjectDraft`（建立用，name/client/ownerId 必填且去頭尾空白、planStart/planEnd 合法、planEnd≥planStart 否則 `invalid_plan_window`）、`buildProjectPatch`（部分更新，僅驗證提供欄位、跨現值檢查視窗）。
    - 專案狀態機（規格 §3.1）：`PROJECT_TRANSITIONS`（ACTIVE↔ON_HOLD、皆可→COMPLETED/CANCELLED；COMPLETED/CANCELLED 終態）、`canTransitionStatus`（同態冪等視為合法）、`assertStatusTransition`（非法拋 `invalid_status_transition`）。
    - 掛載流程：`buildFlowMount(input, caseFallback?)`（flowType/name 必填或由案件帶出、視窗驗證、`normalizeProgress` 夾擠 0..100；**允許先後與重疊故不做重疊阻擋**，規格 §3.2 備註）、`flowsOverlap`（僅供 UI 標示）。
    - 進度認定（規格 §4.1 預設「步驟完成比例」）：`computeStepCompletionProgress`（完成數÷計入步驟，排除 SKIPPED）、`averageProgress`（各流程平均，供 §5.1 KPI 整體進度）。
  - `project-engine.spec.ts`：jest 單元測試 **30 案**（sandbox node 跑全綠；tsc --strict + --noUnusedLocals/--noUnusedParameters 通過）。
  - `project.service.ts`：`ProjectService`（Prisma）：
    - CRUD：`createProject`（產生未碰撞代碼：該月件數+序號、碰撞遞增重試）、`getProject`/`listProjects`（含 flows/exclusions/owner）、`updateProject`、`changeStatus`（狀態機把關）、`deleteProject`（schema onDelete:Cascade 連帶刪 flows/exclusions）。
    - 流程串接：`mountFlow`（caseId 存在性驗證；可由案件帶出 flowType/title；指定 flowType 與案件不符回 `flow_type_mismatch`）、`updateFlowWindow`、`unmountFlow`（僅解除掛載不刪案件）。
    - 進度與向下查看：`refreshFlowProgress`（依案件 StepInstance 完成比例回寫 ProjectFlow.progress；無 case 保留人工值）、`getProjectDetail`（每個流程展開其案件步驟清單：order/步驟名稱/負責角色/負責人，含 overallProgress）。
    - 引擎錯誤經 `guard()` 轉 `BadRequestException`（保留 code 供前端判讀）。
  - `projects.module.ts` / `index.ts`：`ProjectsModule`（imports PrismaModule）。
- `apps/api/src/app.module.ts`：註冊 `ProjectsModule`。

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

## 4.1 交付物（#21，行事曆判斷：假日/連假遞延，§8.3）
- `apps/api/src/calendar/`：行事曆遞延模組（對應需求規格 §8.3，整合 §10.5 專案排除日）。
  - `calendar-engine.ts`：**純邏輯**（無 DB/Nest 相依，日界一律 UTC，與 2.x/3.x 同風格）。
    - 日期工具：`toIsoDate`/`parseIsoDate`(拒絕格式錯誤與溢位日如 2026-02-30)/`addDays`/`calendarDaysBetween`/`weekdayOf`。
    - 行事曆：`HolidayCalendarInput`→`buildCalendar`(假日/補班/可自訂週末；補班與假日衝突時**假日優先**)、`mergeCalendars`。
    - 工作日判斷：`isWeekend`/`isHoliday`/`isMakeupWorkday`/`isWorkday`(補班→工作日；假日/週末→非工作日)/`isNonWorkday`。
    - 注入點：`buildExcludedPredicate(cal, extraExcluded?)`→`isExcluded(date)=>boolean`，可直接餵給 onboarding `buildSchedule`(該函式早已預留此參數，曆法來源待 4.1)。
    - 遞延/工作日運算：`deferToWorkday`(連假整段順延，全為假日拋 `calendar_no_workday` 守門 366 天)/`nextWorkday`/`previousWorkday`/`addBusinessDays`(含負數)/`businessDaysBetween`。
    - 時程重算：`reschedule(anchor, checkpoints, cal, mode, extraExcluded?)`→`RescheduledCheckpoint[]`(原始日/計畫日/遞延天數，依計畫日排序)。**兩種模式**：`DeferralMode.NEXT_WORKDAY`(順延下一工作日，各點獨立)、`DeferralMode.PUSH_FORWARD`(整體後推，位移以工作日計)；預設 NEXT_WORKDAY。
    - 範例假日：`SAMPLE_TW_FIXED_HOLIDAYS_2026`(僅西曆固定日，農曆連假/補班需由來源校正)。
  - `calendar-engine.spec.ts`：jest 單元測試。**沙箱以 node --experimental-transform-types 跑 45 項斷言全綠、tsc --strict 通過**。
  - `calendar.service.ts`：`CalendarService`(Prisma)：buildCalendar(合併範例+自訂)/getProjectExclusionPredicate(讀 Exclusion 區間→predicate)/buildIsExcluded(假日+專案排除日合成)/deferToWorkday/nextWorkday/reschedule。
  - `calendar.module.ts` / `index.ts`：`CalendarModule`(imports PrismaModule)。
- `apps/api/src/app.module.ts`：註冊 `CalendarModule`。

## 4.2 交付物（#22，提醒與通知，§8.3）
- `apps/api/src/reminders/`：後端「提醒與通知」模組（對應需求規格 §8.3，串接 4.1 行事曆）。
  - `reminder-engine.ts`：**純邏輯**（無 DB/Nest 相依，import 4.1 `calendar-engine` 純函式，與 2.x/3.x/4.1 同風格）。
    - 管道/種類：`ReminderChannel`(IN_APP/EMAIL/OTHER)、`ReminderKind`(LEAD 提前/DUE 到期/OVERDUE 逾期)。
    - 規則/政策：`ReminderRule`(kind/offsetDays/inWorkdays 工作日或曆日/channels)、`ReminderPolicy`、`DEFAULT_REMINDER_RULES`(到期前 3、1 工作日 + 到期當日 + 逾期 1 工作日)、`DEFAULT_REMINDER_POLICY`(預設管道 IN_APP)。
    - 提醒對象：`ReminderTarget`(key/label/**dueDate=已遞延計畫日**/recipientId/channels/formCodes/completed)。
    - 展開：`computeReminderOccurrences(targets, policy, cal?)`→`ReminderOccurrence[]`(每 rule×channel 一筆、`dedupKey`、提醒日 fireDate 由 dueDate 推導並遞延至工作日、LEAD 夾擠不晚於到期、依 fireDate→kind→channel 排序)。**關鍵**：fireDate 由「已遞延的 dueDate」推導，故 4.1 重算 dueDate 時提醒時點自動同步（滿足驗收）。
    - 串接：`targetsFromSchedule(items, recipientId, {keyPrefix})`(由 onboarding.buildSchedule / calendar.reschedule 輸出結構建立對象，解耦不 import 對方型別)。
    - 主動派送挑選：`selectDueReminders(occurrences, {now, alreadySent})`→`DueReminder[]`(fireDate<=now 且未派送、未完成；附 daysUntilDue/overdue)。
    - 通知內容：`buildReminderMessage(o)`→繁中標題/內文(依種類)。
    - 派送抽象：`ReminderDispatcher`介面(channel + send)、`dispatchReminders(occurrences, dispatchers)`(依管道路由；缺 dispatcher→`no_dispatcher_for_channel:<CHANNEL>` 不丟錯；dispatcher 丟錯捕捉為 ok:false)、`createCollectorDispatcher`。
    - 去重日誌序列化：`toDispatchLog`/`fromDispatchLog`(毀損拋 `occurrence_corrupt`)。
  - `reminder-engine.spec.ts`：jest 單元測試。**沙箱以 tsc(CommonJS)+node 跑 21 案 / 53 斷言全綠、tsc --strict 通過**。
  - `reminder.service.ts`：`ReminderService`(Prisma + CalendarService)：
    - `buildCaseReminderTargets`(由 StepInstance 有 dueDate 且未完成者組對象、到期日經 `calendar.deferToWorkday` 遞延、負責人取 StepInstance.assignee→Case.assignee)。
    - `dispatchDueReminders`(展開→挑應派送→`activeDispatchers` 派送(預設內建 DbInApp dispatcher 落地 NOTIFICATION_INBOX)→成功者 append-only 落地去重日誌)。
    - `previewReminderMessages` / `listInAppNotifications` / `markNotificationRead` / `getSentDedupKeys` / `registerDispatcher`(注入 Email/其他管道)。
  - `reminders.module.ts` / `index.ts`：`RemindersModule`(imports PrismaModule + CalendarModule)。
- `apps/api/src/app.module.ts`：註冊 `RemindersModule`。

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
- **決策（4.1）**：曆法引擎日界一律以 UTC 判斷（toIsoDate/parseIsoDate 用 getUTC*）。**理由**：避免執行環境時區造成跨日誤差，測試亦可穩定重現。
- **決策（4.1）**：§12-5 遞延規則（順延下一工作日 / 整體後推）未定案，故**兩種模式皆實作**並以 `DeferralMode` 選用、預設 NEXT_WORKDAY，而非臆測單一規則。**理由**：沿用既有「保留介面/可設定、不硬編業務規則」風格(如 3.3 簽核、3.4 roleMatches)；待主管確認後切換即可，不需改引擎。
- **決策（4.1）**：本輪**不新增 Holiday 資料表/migration**；假日來源以「範例固定日 + 呼叫端自訂(公司/政府行事曆)」組成，專案排除日讀既有 Exclusion 表。**理由**：沿用既有「不新增 migration」策略(避免 CI 需 generated client)；持久化假日來源待人類確認來源形式(§12-5)後再補。
- **決策（4.1）**：補班日(makeupWorkdays)與假日衝突時假日優先；補班日視為工作日以支援台灣『週六補班』情境。**理由**：符合『政府宣布放假』直覺，補班為例外的強制上班。
- **決策（4.2）**：提醒時點不獨立儲存，而是由「已遞延的到期日(dueDate)」即時推導(computeReminderOccurrences)。**理由**：直接滿足驗收「遞延後提醒時間同步調整」——4.1 重算到期日後，提醒日自然跟著移動，無需另設同步邏輯或排程資料一致性處理。
- **決策（4.2）**：通知管道(§12-7 待釐清)以 `ReminderChannel` 列舉 + 可插拔 `ReminderDispatcher` 介面抽象，**本輪僅內建並落地系統內(IN_APP)** dispatcher(寫入 NOTIFICATION_INBOX)；Email/其他管道留 `registerDispatcher` 注入點未綁定外部服務。**理由**：沿用 4.1「保留介面/可設定、不臆測」風格；主管確認管道後注入 dispatcher 即可，不需改引擎。
- **決策（4.2）**：提醒規則以「到期前 3/1 工作日 + 到期當日 + 逾期 1 工作日」為**預設**，可由 ReminderPolicy 覆寫；offset 可選工作日或曆日。**理由**：§8.3 未明定提醒時點密度，先給合理可用預設並保留部門自訂。
- **決策（4.2）**：派送去重以 append-only `NOTIFICATION_DISPATCH_LOG`(FormSubmission) 記 dedupKey，跨輪以 getSentDedupKeys 過濾；系統內通知落 `NOTIFICATION_INBOX`。**理由**：沿用既有「不新增 migration、FormSubmission 落地」風格(如 3.4 狀態事件)。
- **決策（4.2）**：reminder-engine 與 onboarding/StepInstance 解耦(以結構型別 `ScheduledLike` / `ReminderTarget` 接收)，由服務層才接 Prisma StepInstance 與 CalendarService。**理由**：與 3.2/3.3 跨模組解耦一致，引擎可純函式測試。
- **決策（5.1）**：專案進度認定先以「步驟完成比例」(規格 §4.1 預設建議)實作 `computeStepCompletionProgress`(排除 SKIPPED)，progress 欄位仍可人工覆寫。**理由**：§9-1(步驟比例/加權工時/人工填報)未定案，先給可用預設並保留覆寫，待主管確認。
- **決策（5.1）**：掛載流程**不阻擋時間重疊**(僅 `flowsOverlap` 供 UI 標示)。**理由**：規格 §3.2 備註明示流程間可先後與重疊(如導入未結束即開始環境建置)。
- **決策（5.1）**：專案代碼採 `PRJ-YYYYMM-####`，服務層以「該月件數+序號」產生並對 `code @unique` 碰撞遞增重試(極端退路加時間戳尾碼)。**理由**：可讀、按月可辨識，避免依賴外部序列；唯一性由 schema 把關。
- **決策（5.1）**：專案狀態機與既有 `ProjectStatus`(ACTIVE/COMPLETED/ON_HOLD/CANCELLED)對齊，COMPLETED/CANCELLED 設為終態、同態轉移冪等合法。**理由**：對應規格 §3.1，避免誤從終態復活；冪等讓重送同狀態不報錯。
- **決策（5.1）**：服務層只做專案/掛載 CRUD 與向下查看(getProjectDetail 展開案件步驟與負責人)；甘特圖(5.2)、延遲/超前(5.3)、排除日順延(5.4)、簡報(5.5)、雙向導覽 UI(5.6)留後續 issue。**理由**：小步前進，符合 issue 5.1 驗收範圍。
- **決策（5.2）**：甘特圖以**純引擎輸出「呈現用幾何 + 狀態 + KPI」**(0..1 比例)交前端繪製，引擎不產生任何 SVG/DOM。**理由**：沿用純引擎風格可純函式測試；比例化讓前端自由決定像素寬度與 RWD。
- **決策（5.2）**：時間軸範圍取 min(專案 planStart, 所有流程 planStart)..max(專案 planEnd, 所有流程 planEnd)，使超出專案計畫期間的流程(§3.2 允許重疊/先後)仍完整可見；今日線超出軸時夾擠並標 `inRange=false`。**理由**：避免長條被裁切；今日線位置正確為驗收要點。
- **決策（5.2）**：延遲/超前狀態沿用規格 §4.2 線性預期 + §4.3 delta/容許門檻 T，T 先用引擎預設 8(§9-2 待定案，可由 GanttService 呼叫端覆寫)。**理由**：5.2 KPI 需「延遲數/超前數」，必須先有狀態判斷；完整的 5.3(天數換算、依流程型別不同門檻)留 #25。
- **決策（5.2）**：排除日在甘特圖**僅作網底標示與 KPI 區間計數**，不在此順延 planEnd。**理由**：順延重算(串接 4.1 reschedule)屬 5.4 #26，避免越界改動流程計畫日。

## 未完成 / Handoff（下一輪或人類接手）
1. ✅（3.1）拜訪/會議紀錄 + 成案移交藍圖持久化落地（getHandoff 可取回）。
2. ✅（3.2）系統導入流程引擎 + 服務落地：接收銷售移交、預定義時間點/提醒、委任權限表簽核把關、**移交工程建立 ENVIRONMENT 案件**。
3. ✅（3.3）環境建置流程引擎 + 服務落地：依銷售模式分支、接收導入移交、主機採購等待狀態、環境驗收把關→COMPLETED。
4. **CI 全流程驗證**：3.3/3.4/4.1/4.2/5.1/5.2/5.3 引擎 + spec 已於 sandbox 驗證(tsc --strict + node 測試全綠)；各 `*.service.ts`（含 projects、gantt、delay） 以 stub(PrismaService/@nestjs/common/@prisma/client) 通過 strict typecheck（5.1/5.2 另過 --noUnusedLocals/--noUnusedParameters），惟未在真實 monorepo 跑 `pnpm -r build`(需 generated Prisma client)。下輪/人類 review 時請確認 CI build 綠。
5. ✅（3.4）客製化（需求變更）流程引擎 + 服務落地：需求變更單→指派鏈→開發/測試文件→複測（不通過退回循環）→測試區→正式區兩道關卡→COMPLETED。
6. ✅（4.1）曆法遞延引擎 + CalendarService 已落地：可產生 `isExcluded` predicate 注入 onboarding/environment `buildSchedule`、支援兩種遞延模式重算、整合專案排除日(§10.5)。**仍待整合**：將 onboarding/environment service 實際呼叫 `CalendarService.buildIsExcluded()` 注入 buildSchedule(目前仍為預設 identity，未串接)；持久化假日來源(Holiday 表 / 政府行事曆匯入，§12-5)；遞延模式政策定案(目前預設 NEXT_WORKDAY)。
7. ✅（4.2）提醒與通知引擎 + ReminderService 已落地：多時點提醒、提醒日隨到期日遞延同步、可插拔多管道(本輪僅 IN_APP 落地)、跨輪去重。**仍待**：(a) Email/其他管道 dispatcher 接外部服務並 `registerDispatcher`(§12-7)；(b) **定時觸發**——目前 `dispatchDueReminders(caseId, {now})` 為被呼叫式，尚未接排程器(cron/任務佇列)定期掃描全案件派送；(c) 提醒規則(時點密度)是否需可由流程設計器設定；(d) StepInstance.dueDate 來源——需與 5.x 專案管理/流程推進實際把 dueDate 寫入 StepInstance 後，提醒才有資料。
8. ✅（5.1）專案 CRUD 與流程串接引擎 + ProjectService 已落地。✅（5.2）甘特圖呈現引擎 + GanttService 已落地：軸/月份刻度/長條+完成填色/今日基準線+inRange/§4.2 預期進度/§4.3 狀態與 delta/排除日網底/KPI(整體進度·延遲·超前·排除日區間數)；getProjectGanttFresh 先回寫步驟比例再產生。✅（5.3）延遲/超前計算引擎 + DelayService 已落地(#25：天數換算、依流程型別容許門檻 T、可選日曆日/工作日基準均完成)。**仍待**：(b) **5.4 排除日 CRUD 與順延重算**(#26：串接 4.1 calendar `reschedule`/`buildIsExcluded`，目前甘特圖僅標示排除日不順延 planEnd)；(c) **5.5 簡報模式**(#27)、**5.6 案件↔專案雙向導覽**(#28：gantt rows 已透傳 caseId、getProjectDetail 已回傳步驟，UI 跳轉待補)；(d) 進度認定方式 §9-1 定案(目前預設步驟比例)。
9. **REST controller / 前端 UI**：sales / onboarding / environment / customization / calendar / reminders / **projects(含甘特圖、延遲清單)** 皆尚未提供（屬後續 API 層任務；reminders 另需「通知中心」前端與已讀互動；projects 需專案管理主畫面、甘特圖繪製與簡報模式）。
10. **服務層整合測試**：sales/onboarding/environment/customization/reminders/projects/gantt/delay service 目前僅引擎層純函式測試覆蓋；DB 行為待後續以整合測試補強。

## 待釐清（沿用，需求 §12 / 專案管理模組規格 §9）
- §12-1 跨角色移交是否需主管核可、流程一律由特定角色發起 → 設計器已留「觸發角色＋條件」欄位，實際核可關卡待釐清（3.4 指派鏈已留 roleMatches 回報、未強制）。
- §12-2 失敗原因分類項目（供改善分析報表）→ 影響 3.1 失敗分類 Enum 收斂，目前以可擴充字串承載。
- §12-3 各表單實際欄位（報價單/客製需求/委任權限表/人員資料表/環境建置檢核表等）→ 目前僅以 code 標識容器、data 承載 JSON。
- §12-4 各表單簽核關卡與層級 → 影響環境驗收/客製化複測是否需簽核（3.3/3.4 目前未強制，保留簽核集合介面）。
- §12-5 行事曆遞延規則（順延下一工作日/整體後推）→ **4.1 已實作兩種模式(DeferralMode)並預設 NEXT_WORKDAY，待主管定案選用**；假日持久化來源(Holiday 表/政府行事曆)亦待確認。
- §12-7 提醒管道（系統內/Email/其他）→ **4.2 已以可插拔 dispatcher 抽象並落地 IN_APP，Email/其他待主管確認管道與外部服務後 registerDispatcher 注入**；另定時觸發機制(cron/任務佇列)待規劃。
- §12-10 附件/範本實體儲存於系統或改以 SharePoint/OneDrive 連結為主、允許檔案類型與大小上限 → 影響 2.4/2.5 上傳實作，待主管確認。
- 專案管理模組規格 §9-1 進度認定方式（步驟比例/加權工時/人工填報）→ **5.1 先以步驟完成比例為預設並保留 progress 可人工覆寫，待主管定案**。
- 專案管理模組規格 §9-2/§9-3/§9-6 容許門檻 T、預期進度日曆日或工作日基準、排除日順延規則 → 影響 5.2/5.3/5.4：**5.2 甘特圖已用 §4.2 線性預期 + §4.3 預設 T=8 呈現狀態；5.3 延遲/超前已實作天數換算、依流程型別覆寫 T、CALENDAR/WORKDAY 基準可選(預設值待主管定案)**；排除日順延 planEnd 待 #26 與主管定案。
