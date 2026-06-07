# 8.2 進度筆記（#34，前端串接 REST 並補專案管理相關 UI）— 🔄 進行中

> 本檔為 progress.md 之增量筆記（沿用 progress-6.2 / progress-7.1 / progress-8.1 notes 模式；主檔過大，避免整檔重寫）。
> 下一輪接手前請先讀本檔與 issue #34 的 🤖 comment。

## 本輪完成（2026-06-07，第 1 輪）
- **前端共用 REST client**：`apps/web/src/lib/api.ts`
  - `API_BASE`（`VITE_API_BASE_URL`，預設 `http://localhost:3000`）、`credentials: 'include'`（session cookie 認證）。
  - `ApiError`（保留 HTTP status + 後端錯誤碼；`status === 0` 表連線失敗）；`toErrorBody` 容忍自訂 `{code,message}`、Nest 預設格式、message 陣列與非 JSON 文字。
  - `buildQuery`（純函式：略過 null/undefined/空字串、Date→ISO、false/0 照常輸出）。
  - `apiGet / apiPost / apiPatch / apiDelete`。
- **task-kanban 改接 REST（看板顯示真實資料，非 seed）**：
  - `features/task-kanban/api.ts`：`kanbanQuery`（純函式）+ `fetchKanbanBoard` → `GET /kanban`。
  - `features/task-kanban/TaskKanbanPage.tsx`：容器元件；載入／錯誤（401 未登入、403 無 case:read、連線失敗）提示與重試；成功後交 `TaskKanbanView` 呈現。
  - `index.ts` 匯出新增 `TaskKanbanPage / fetchKanbanBoard / kanbanQuery`。
- **App.tsx**：新增「任務看板」分頁（`TaskKanbanPage`）；`API_BASE` 改由 `lib/api` 匯入（單一來源）。
- **測試／驗證（本輪 sandbox 實測）**：
  - 新增 `lib/api.test.ts`（9 項）＋ `task-kanban/api.test.ts`（5 項）。
  - `pnpm --filter @wfms/web install` → `vitest run`：**7 檔 83 項全綠**（含既有 69 項）；`tsc -b`、`vite build` 均綠。
  - 註：本輪 sandbox 未再出現先前紀錄的 vitest worker bus error（供 9.2 參考）。

## 技術決策
- client 以薄 fetch wrapper 起步（不引入 axios / react-query）：依賴最小、與既有 feature「純邏輯 + vitest」風格一致；快取／重新驗證待需求明確再評估。
- 錯誤碼透傳：後端 guard() 慣例之 `code` 原樣保留於 `ApiError.code`，前端據此顯示對應提示（401/403/連線失敗有人話提示）。
- `TaskKanbanView` 不動、以 `TaskKanbanPage` 容器包裝：呈現層（6.1 已測）與取數層分離，seed 仍可供展示與測試。

## 尚未完成（下一輪優先序）
1. project-gantt／ProjectWorkspace 改接 `GET /projects`（專案選擇器）＋ `GET /projects/:id/gantt`、`/detail`（取代 seed）。
2. kanban `onOpenCase` 串實際案件詳情（可沿用 project-gantt 之 CaseDetailPanel 或 case-detail feature）。
3. 專案 CRUD／流程掛載／排除日管理／延遲清單 UI（`POST/PATCH/DELETE /projects…`、`/delays`、`/exclusions`、`/exclusion-conflicts`）。
4. 過濾改後端參數（目前看板仍客端過濾；REST 已支援 role/flowType/onlyMine）。
5. progress.md 主檔「各 issue 狀態」表已過時（停在 3.x），待人工或低成本工具一併更新。
