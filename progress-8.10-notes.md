# 8.10 前端 專案管理頁串接 /projects 系列（issue #45）—— 2026-06-11 單輪完成

## 本輪產出（commits 367dbd2 / 13c7b7b / 8430aa3 / 本 commit）

- `apps/web/src/features/project-gantt/api.ts`（新增）：/projects 系列 18 端點的型別鏡像
  （ProjectSummary/ProjectRecord/DelayReport/FlowConflict/ExclusionRecord 等）與 fetch 包裝；
  query 組裝（projectsQuery/ganttQuery/delaysQuery）與映射（toProjectGanttData/projectOverallProgress/isoDay）為純函式。
- `manage.ts`（新增）：表單純邏輯——驗證規則鏡像後端引擎（buildProjectDraft / normalizeFlowMount /
  exclusion-engine）、狀態機鏡像（allowedStatusTargets）、顯示字典（狀態/流程型別/來源）。
- `ProjectWorkspacePage.tsx`（新增）：專案選擇器（GET /projects，含狀態與整體進度%）、
  選定後並行載入 detail/gantt/delays/exclusion-conflicts、fresh 重整（回寫進度後重算）、
  差異天數基準切換（CALENDAR/WORKDAY）、建立專案表單；stale-while-revalidate＋序號防競態（沿用 8.9 慣例）。
- `ProjectManagePanel.tsx`（新增）：甘特下方維護面板——衝突警示（§9-6 A 案，僅警示不順延）、
  延遲/超前清單（含 summary）、流程掛載（掛載/編輯視窗進度/重算進度/移除）、
  排除日維護（新增/編輯/移除，§10.5）、專案基本資料編輯/狀態轉換/刪除。
- `App.tsx`：「專案進度」頁籤改接 ProjectWorkspacePage（帶 currentUserId 供建案預填負責人）。
- 測試：`api.test.ts`＋`manage.test.ts` 共 27 案；web vitest 基準 14 files/131 → **16 files/158 全綠**；
  `pnpm --filter @wfms/web build`（tsc -b + vite）綠。

## 關鍵技術決策

1. **fresh 只帶在 gantt 請求**：並行載入時若 gantt 與 delays 都帶 fresh=true 會重複回寫進度；
   回寫一次後 delays 讀到的已是更新後資料。
2. **前端驗證鏡像後端引擎**（非取代）：送出前即時提示；後端 400 {code,message} 仍為最終把關，
   ApiError.message 直接顯示於表單錯誤區。
3. **狀態機鏡像**：僅提供合法轉換按鈕（ACTIVE⇄ON_HOLD、→COMPLETED/CANCELLED；終態無出邊），
   避免使用者送出必敗請求。
4. **案件側欄留第二階段**（issue 明許可分兩階段）：ProjectWorkspace 的案件雙向導覽仍用 seed 對照；
   真實 caseId 不在 seed map → 不提供跳轉（無害）。改接 `GET /cases/:id/detail` 建議併入 8.12（#47）。
5. **刪除專案按鈕對所有人顯示**：權限由後端 RBAC（project:manage）把關，403 時顯示錯誤提示；
   避免前端重複維護權限矩陣。

## 驗收對照（issue #45）

- ✅ 專案清單/選擇器接 GET /projects；甘特接 GET /projects/:id/gantt?fresh=；延遲接 GET /projects/:id/delays。
- ✅ 排除日維護接 GET/POST /projects/:id/exclusions、PATCH/DELETE /projects/exclusions/:id；
  衝突警示接 GET /projects/:id/exclusion-conflicts。
- ✅ 專案 CRUD 與流程掛載 UI（POST/PATCH/DELETE + POST /projects/:id/flows + flows 維護三端點）。
- ✅ fresh 重新整理會回寫步驟比例後重算（甘特與延遲同步反映）。
- ✅ 簡報模式純呈現邏輯未動。
- （側欄部分依 issue 規劃後補，見決策 4）

## 後續（下輪可動工）

- #46（8.11 流程定義設計器改接 REST）相依 #41 已 done，可動工。
- CI 三 job 需人類於 Actions 頁確認（sandbox 讀不到 check-runs）。
