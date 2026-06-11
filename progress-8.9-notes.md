# 8.9 前端 任務看板串接 GET /kanban（#44）— 進度筆記（2026-06-11，單輪完成）

## 背景
8.2（#34）/ 8.4（#39）已完成 fetch 驅動（TaskKanbanPage 呼叫 GET /kanban、loading/error 依 8.4 慣例），
但過濾器仍為**客端過濾**（board-view.ts filterBoard），未對應 query 參數；onlyMine / upcomingWithinDays 未曝露於 UI。

## 本輪變更（apps/web/src/features/task-kanban/）
- `types.ts`：逐欄比對後端 kanban-engine 之 KanbanCard，鏡像補齊 `stepDefinitionId`、`responsibleRoleId` 兩欄。
- `board-view.ts`：新增伺服端過濾純邏輯——`KanbanFilterState` / `DEFAULT_KANBAN_FILTER` / `toKanbanQuery()`（UI 狀態→query 參數；空值不送、視窗等於後端預設 3 不送）/ `FLOW_OPTIONS` / `UPCOMING_WINDOW_OPTIONS` / `mergeFlowOptions()`（固定選項∪未知型別，下拉不因結果縮水）。舊 `filterBoard` 保留（純函式、測試與離線展示仍可用）。
- `TaskKanbanView.tsx`：改**受控元件**（filter + onFilterChange props）；移除客端 filterBoard 與 seed 預設；KPI / 分欄 / 計數直接用後端結果；新增「僅看與我相關」checkbox 與「到期視窗」下拉（3/5/7/10 工作日）；KPI 標題隨視窗動態；全板空狀態（EmptyState + 清除過濾按鈕）；refreshing 淡化 + aria-busy；側欄「前往案件詳情」改為僅在提供 onOpenCase 時顯示（避免死按鈕）。
- `TaskKanbanPage.tsx`：持有過濾器狀態，變更即帶 query 參數重查；重查期間保留舊板淡化（stale-while-revalidate）；遞增序號 seqRef 防過時回應覆蓋（快速切換過濾器時）。
- `seed.ts`：card() 預設補新增兩欄；僅供測試與展示，不再被 View 預設使用。
- `board-view.test.ts`：新增 toKanbanQuery / mergeFlowOptions 共 6 案。

## 驗證（sandbox 真跑）
- `pnpm --filter @wfms/web build`（tsc -b + vite）✅
- `pnpm --filter @wfms/web test`：vitest **14 files / 131 案全綠**（含本輪新增 6 案；task-kanban 21 案）。

## 技術決策
1. **伺服端過濾取代客端過濾**：issue 要求「UI 過濾器對應 query 參數」；且後端已依可見範圍收斂、KPI 一致性應以後端為單一真相（客端過濾會讓 KPI 與後端結果不一致）。
2. **視窗等於預設 3 時不送參數**：與後端預設解耦，避免後端改預設時前端頉死舊值。
3. **stale-while-revalidate + 序號防競態**：過濾器切換頻繁，整頁 loading 閃爍體驗差；保留舊板淡化並以遞增序號丟棄過時回應。
4. **卡片點擊帶 caseId**：保留現行側欄行為（issue 允許）；onOpenCase 介面已就緒，App.tsx 導頁留待 8.12（#47）案件詳情頁串接時接線（避免本輪臆測路由設計）。

## 交付 commits（main）
- `89ffb77`：types/seed/board-view/board-view.test（型別鏡像補欄、過濾純邏輯、測試）。
- 本 commit：TaskKanbanView / TaskKanbanPage 受控化與頁面串接、本筆記。

## 後續（交接給 8.10～8.14）
- 8.12（#47）案件詳情頁完成後，於 App.tsx 將 `<TaskKanbanPage onOpenCase={...} />` 接上導頁。
- CI 三 job（build-test / migration-check / integration-test）請於 Actions 頁確認；sandbox 讀不到 check-runs（api.github.com 回空 body，舊問題）。
