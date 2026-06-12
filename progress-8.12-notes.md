# progress 8.12 notes（issue #47：前端 案件詳情/推進頁串接）

完成日期：2026-06-12（單輪完成，自動排程）

## 落地內容
- `apps/web/src/features/case-detail/` 全面改為 REST 驅動（原 seed 驅動之 UI 重構）：
  - `api.ts`（新增）：鏡像後端 DTO（CaseDetail/CaseStep/CaseStepForm/CaseAttachment/CaseSummary，
    enum 以字串聯集對齊 schema.prisma）；fetchers：`GET /cases`、`GET /cases/:id/detail`、
    `POST /cases/:id/advance|return`（8.7）、`POST /forms/submissions`、`/forms/submissions/:id/approve|reject`、
    `POST /attachments`（8.8）。`caseListQuery` / `returnCaseBody` 為純函式可測。
  - `presentation.ts`（新增）：顯示對映層（流程/狀態/銷售模式標籤與 pill、done/active 判定、
    activeStepIndex、returnTargets、canAdvance/canSign/canFill、unmetRequiredFormNames、附件 meta），
    純函式可測——對齊 8.7 決策 3「顯示標籤屬前端對映層職責」。
  - `CaseDetailPage.tsx`（新增，容器）：清單＋詳情載入（stale-while-revalidate、遞增序號防競態，
    與 8.9/8.10 慣例一致）；動作統一包 `runAction`（busy/錯誤/成功訊息/動作後重抓詳情，推進/退回另刷清單）。
  - `CaseDetailView.tsx`（重構，純呈現）：stepper（done/active 依後端）、表單填寫/送出/簽核、
    當前步驟推進（備註）與退回（目標步驟＋必填原因）、附件清單＋加入連結；
    動作錯誤顯示 `{code, message}`＋errorHint（403 權限提示），權限以後端為準。
  - 舊 `seed.ts`/`types.ts` 保留檔案但不再被引用（index.ts 已改 export 新元件；MCP 無法刪檔）。
- `App.tsx`：新增「案件詳情」分頁；`openCase(caseId)`＝設 caseId＋切 tab——
  看板（`TaskKanbanPage onOpenCase`，8.9 預留）與專案管理（`ProjectWorkspacePage onOpenCase`，新增）統一導入。
- `ProjectWorkspace.tsx`：新增可選 `onOpenCase`——提供時甘特列點擊改導統一案件詳情頁
  （caseId 為真實 DB id）；未提供退回內嵌 seed 側欄（既有測試不變、向後相容）。

## 關鍵決策
1. **表單填寫採自由文字（data={content}）**：8.8 `GET /steps/:stepId/forms` 可帶欄位定義渲染動態表單，
   但 detail 回傳已含每步驟表單彙整狀態、且欄位級 UI 牽涉表單設計器（8.11 範疇外）尚未定案；
   先以 content 文字提交滿足「可填表單、簽核、留存軌跡」驗收，欄位級渲染留 follow-up（要做時接 stepDefinitionId）。
2. **權限顯示策略**：前端僅以「流程狀態」收斂（非當前步驟不出現推進區、已簽核不可再填、
   不可簽核者不出現簽核鈕）；角色權限不在前端複製 RBAC 矩陣，以後端 403＋errorHint 明確提示
   （驗收「無權限操作…被後端拒絕時有明確提示」採後者，避免雙處維護矩陣漂移）。
3. **附件僅支援「加入連結」**：後端 `POST /attachments` 收 fileUrl/linkUrl（不代理檔案串流），
   瀏覽器直傳檔案需另有上傳服務（SharePoint 直傳屬 M365 整合範疇）；UI 先開 LINK（SharePoint/OneDrive 優先），
   FILE 列仍可顯示與開啟。
4. **導頁用 App 內 tab + state（不引入 router）**：專案無 react-router，沿用既有 tab 架構，
   `caseId` 由 App 持有；看板/專案兩處 openCase 即收斂於同一頁（驗收要點）。
5. **四大流程專屬動作（成案/移交/複測/部署關卡等）未在本頁開 UI**：通用推進/退回已覆蓋日常推進；
   專屬動作各有業務欄位（如失敗原因、移交對象），屬各流程頁範疇，避免在通用頁臆測業務規則——
   留 follow-up 待規格定案（#38 10.1 相關）。

## 驗證（sandbox 真跑）
- `pnpm install --ignore-scripts --prefer-offline` → `pnpm --filter @wfms/web build`（tsc -b + vite）✅
- `pnpm --filter @wfms/web test`（vitest）：**19 files / 190 tests 全綠**（8.11 基準 17/170，
  新增 api.test 4 案＋presentation.test 16 案）。
- api 未動，未跑。

## 後續
- 佇列剩 #48（8.13 通知收件匣，下輪可動工）、#49（8.14 假日維護 UI）、#38（10.1 主管定案追蹤，刻意跳過）。
- follow-up（未開 issue）：欄位級動態表單渲染（接 `GET /steps/:stepId/forms`）、流程專屬動作 UI、檔案直傳。
