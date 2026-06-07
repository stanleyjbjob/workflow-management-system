# 8.3 進度筆記（#35，前端 ISO 文件化軌跡／稽核查閱頁）— ✅ 完成

> 本檔為 progress.md 之增量筆記（沿用 progress-6.2 / 7.1 / 8.1 / 8.2 notes 模式）。

## 本輪完成（2026-06-07）
- **新增前端 feature `apps/web/src/features/iso-trail/`**（沿用 task-kanban 8.2 後的「純邏輯 + api + View + Page 容器」風格）：
  - `types.ts`：後端 iso-trail-engine 輸出之前端鏡像（TraceabilityRecord / TrailSummary / TraceEvent；Date→string）＋繁中標籤表（紀錄類別 / 文件種類 / 事件動作）。
  - `trail-view.ts`：**純呈現邏輯**（無 fetch/DOM/React 相依）— `signStatusMeta` 五態徽章、`retentionLabel`（null→「不限／未定」，issue 補充）、`formatDateTime`（UTC 穩定可測）、`buildSummaryCards`（KPI：總數/需簽核/簽核缺口/留存到期；缺口>0 警示色）、`topAspects`（ISO 面向分布）、`sortTrail`（遞減、回傳複本不變動輸入）、`signFilterToQuery`（UI 單選 → requiresSignatureOnly/signedOff 組合）。
  - `api.ts`：`trailQuery`（GET /iso-trail 全參數）、`exportQuery`（summary/export 僅支援 recordType/documentKind/caseId/projectId 四項，**日期與簽核參數刻意不上匯出端點**）、`fetchTrail` / `fetchTrailSummary`、`exportJsonUrl` / `exportCsvUrl`（session cookie 認證下直接 <a href> 下載）、`TrailFilterState` + `filterToQuery`。
  - `IsoTrailView.tsx`：KPI 列（grid-kpi）＋ISO 面向 pill 分布＋過濾列（類別/文件種類/簽核/案件/專案/日期區間＋套用）＋軌跡表格（點列展開簽核與事件軌跡、空清單提示）＋匯出 JSON/CSV 按鈕；視覺對齊 prototype。
  - `IsoTrailPage.tsx`：容器（與 TaskKanbanPage 同模式）— Promise.all 取 /iso-trail + /summary、載入/錯誤（401 未登入、403 無 case:read、0 連線失敗）提示與重試、套用過濾後重新取數。
  - `seed.ts`：示範資料（與 sampleTrailSummary 數字一致），供展示與 View 預設值。
  - 測試：`api.test.ts`（8 項）＋`trail-view.test.ts`（10 項）。
- `App.tsx`：新增「稽核軌跡」分頁（IsoTrailPage）。
- **驗證（sandbox 實測）**：`vitest run` **9 檔 101 項全綠**（新增 18 項）；`tsc -b` 綠；`vite build` 綠。

## 技術決策
- 過濾交給後端（REST 已支援），前端按「套用過濾」重新取數；不做客端二次過濾，避免與後端可見範圍收斂（AccessScopeService）語意分歧。
- 匯出以 `<a href>` 直接連 GET /iso-trail/export(.csv)：session cookie 同源帶出、後端已設 Content-Disposition，無需 blob 下載邏輯。
- summary/export 端點僅支援四項過濾 → `exportQuery` 刻意只帶四項，避免讓使用者誤以為日期/簽核過濾會反映在匯出內容。

## 驗收對照（issue #35）
- 可查閱與過濾稽核軌跡 ✅（類別/文件種類/案件/專案/日期/簽核）
- 檢視簽核缺口 ✅（KPI 卡＋簽核過濾「簽核缺口」選項）
- 下載 CSV ✅（/iso-trail/export.csv）
- retentionUntil 未注入政策顯示「不限／未定」✅

## 給後續輪次的提醒
- progress.md 主檔「各 issue 狀態」表仍停在舊狀態（8.1 以前），依慣例未整檔重寫；狀態以各 progress-*-notes.md 為準。
- 本頁目前無 SSO 登入 UI（#40），未登入時會顯示 401 提示；待 #40 完成後體驗才完整。
