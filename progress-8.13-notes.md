# progress 增量筆記 — 8.13 前端 通知收件匣 UI（issue #48）

> 接續 progress-8.12-notes.md。本檔記錄 2026-06-12 排程輪完成 8.13 的內容。

## 本輪完成

- **後端微補充**（`apps/api/src/reminders/reminder.service.ts`）：
  `listInAppNotifications` 回傳新增 `caseId: string | null`（FormSubmission 落地時本就帶 caseId，
  僅補 select 與輸出）。issue 預期「通知帶 caseId 點擊開案件」必需此欄；additive、不破壞既有呼叫端。
- **新 feature `apps/web/src/features/notification-inbox/`**（沿用既有結構：純邏輯 .ts + vitest + .tsx）：
  - `types.ts`：`InboxNotification` 鏡像後端 DTO（createdAt 為 ISO 字串；caseId 容忍 undefined/null）。
  - `api.ts`：`inboxQuery`（純函式）＋ `fetchInbox` / `markNotificationRead`（走 lib/api，401 統一導登入）。
  - `inbox-view.ts`：`unreadCount`、`badgeText`（99+ 截斷）、`markReadLocally`（樂觀已讀）、
    `visibleNotifications`（只看未讀客端過濾）、`kindLabel`/`kindColor`（LEAD/DUE/OVERDUE）、
    `formatNotificationTime`（相對時間，now 注入便於測試）。
  - `NotificationBell.tsx`：topbar 鈴鐺（未讀徽章）＋下拉收件匣。掛載即抓（徽章）、展開/重新整理重抓、
    遞增序號防競態（沿用 8.9 慣例）；點通知＝樂觀標已讀（失敗回滾）＋ POST read；帶 caseId 者導向案件詳情並收合。
  - 測試：`api.test.ts`（4 案）＋ `inbox-view.test.ts`（9 案）。
- **App.tsx**：header 右側加 `<NotificationBell onOpenCase={openCase} />`（僅登入時顯示），與 AccountBadge 並排。

## 驗證（sandbox 實跑）

- web：`pnpm --filter @wfms/web build` ✅；`test` **21 files / 203 案全綠**（8.12 後基準 19/190，+2 files/+13 案）。
- api（因動了 reminder.service.ts）：假引擎 `prisma generate` → `pnpm build`（nest build）✅ →
  jest **37 suites / 630 案全綠**（與 8.8 後基準一致，無破壞）。

## 設計決策

- caseId 缺口採「後端補欄位」而非前端略過：issue 驗收明列點擊開案件；列表 select 本就含該欄，成本最低。
- 「只看未讀」為客端過濾（一次取回預設 100 筆內篩選），不重打 API；後端 unreadOnly 參數保留給未來大量資料情境。
- 不做輪詢/推播：掛載與每次展開時重抓已滿足「未讀數正確、標已讀即時更新」；WebSocket/SSE 留待有需求再議。
- 標已讀失敗（含 404 非本人）僅靜默回滾未讀狀態，不彈錯誤——避免打斷主流程。

## 佇列現況

- 剩 **#49（8.14 假日維護 UI，下輪可動工）**、#38（10.1 主管定案追蹤，刻意跳過不掛 in-progress）。
