# 7.1 交付物與進度紀錄（#31 Holiday 假日資料表與行事曆 DB 化）

> 本輪（2026-06-07，自動排程）狀態：🔄 **未完成**（保留 in-progress；詳見下方「未達成 / Handoff」）。
> 此為 progress.md 的衛星紀錄（沿用 progress-6.2-notes.md 慣例）；progress.md 主表後續可一併刷新。

## 本輪完成項目

### 1. Prisma schema：新增 Holiday 模型與兩個 enum
- `apps/api/prisma/schema.prisma`：
  - `enum HolidayType { HOLIDAY MAKEUP_WORKDAY }`、`enum HolidaySource { GOVERNMENT COMPANY }`。
  - `model Holiday`：`date DateTime @db.Date`（純日期，與 calendar-engine UTC 日界一致）、`name`、
    `type`（預設 HOLIDAY）、`source`（預設 GOVERNMENT）、`note?`、`createdAt`/`updatedAt`。
  - `@@unique([date])`（一日一筆，供 seed upsert 與避免重複）、`@@index([type])`。
- **決策**：將「補班」併入單一 `Holiday` 表以 `type=MAKEUP_WORKDAY` 表示，不另開 `MakeupWorkday` 表。
  **理由**：兩者都是「日期 → 工作日語意覆寫」，單表更簡潔；calendar-engine 既有「假日優先於補班」規則天然適用。

### 2. 首批 Holiday migration（已用 PGlite 驗證乾淨套用）
- `apps/api/prisma/migrations/20260607000000_holiday/migration.sql`：手寫（sandbox 內 prisma 引擎二進位被網路阻擋無法跑
  `migrate diff`），格式對齊既有 `20260606010000_login_audit` 之 Prisma 產出風格。
- **驗證**：以 `@electric-sql/pglite`（WASM Postgres）實際套用本 migration → 通過；並驗證：插入 HOLIDAY/MAKEUP_WORKDAY、
  enum 預設值、`@@unique([date])` 重複插入被擋。全綠。

### 3. CalendarService：改讀 DB 假日 + Holiday CRUD
- `apps/api/src/calendar/calendar.service.ts`：
  - 新增純函式 `holidayRowsToCalendarInput(rows)`：Holiday 列 → `{holidays, makeupWorkdays}`（type 判斷、UTC 日界）。
  - 新增 `async loadCalendar(custom?)`：讀 `Holiday` 表並與「內建範例固定日 + 呼叫端自訂」合併。
  - 既有 async 方法 `buildIsExcluded / deferToWorkday / nextWorkday / reschedule` 全部改用 `loadCalendar`（→ 遞延由 DB 假日驅動）。
  - 同步 `buildCalendar(custom?)` 保留供無 DB 兜底。
  - Holiday CRUD（主管維護 §12-5）：`listHolidays（區間/類型過濾）/ addHoliday / updateHoliday / removeHoliday`，
    含 P2002（日期重複→`holiday_date_duplicate`）/ P2025（NotFound）處理與日期正規化。
- `apps/api/src/calendar/holiday-mapping.spec.ts`：5 案 jest 測試（拆分、預設視為假日、補班週六變工作日、假日遞延、衝突假日優先）。
  邏輯已於 sandbox 以等價 node 斷言全綠（6/6）。

### 4. 看板遞延同步 DB 假日
- `apps/api/src/kanban/kanban.service.ts`：`getBoard` 將 `this.calendar.buildCalendar(...)` 改為
  `await this.calendar.loadCalendar(...)`，使 6.1 看板的到期 / 遞延標示與工作日視窗改由 `Holiday` 表驅動。

### 5. seed 範例假日
- `apps/api/prisma/seed.ts`：新增 `seedHolidays()`（TW 2026 示範假日 + 2 個補班日），以 `date` 唯一鍵 upsert（idempotent）；
  `main()` 末尾呼叫。⚠️ 農曆假日 / 彈性放假僅示範，正式請由主管於系統維護校正。

### 6. CI：新增 migration-check job
- `.github/workflows/ci.yml`：新增獨立 `migration-check` job（Postgres 16 service → `prisma migrate deploy` → `db:seed`），
  自動驗證「migration 乾淨套用 + seed 可建立假日」。與 `build-test` 分離，避免 DB 服務影響純編譯 / 單元測試。

## 未達成 / Handoff（下一輪或人類接手）
1. **acceptance #3「buildSchedule 實際套用假日排除」尚未達成（本輪未做）**：
   現況 `OnboardingService` / `EnvironmentService` **尚未呼叫** onboarding-engine 的 `buildSchedule`，
   亦尚未產生 `StepInstance.dueDate`（屬 progress.md Handoff 第 7 項「dueDate 來源」之上游工作）。
   待排程 / dueDate 寫入落地後，於該處注入 `await calendar.buildIsExcluded({ projectId, custom })` 即可滿足。
2. **真實環境驗證**：sandbox 因 prisma 引擎二進位被網路阻擋，無法跑 `pnpm -r build`（需 generated client）與 jest。
   migration SQL 已用 PGlite 驗證、對應邏輯已用 node 斷言驗證；仍需在真實 CI 確認：
   (a) 新 `migration-check` job 綠燈；(b) `pnpm -r build` 帶新 Holiday 型別通過；(c) `holiday-mapping.spec.ts` jest 綠。
   （與 #37「CI 全流程驗證」重疊，可一併處理。）
3. **CRUD 對外 REST**：CalendarService Holiday CRUD 已就緒，REST controller（供主管維護介面）待 8.1 一併補。

## 技術決策摘要（供 review）
- 補班併入 Holiday 表（type 區分），不另開表。
- Holiday.date 用 `@db.Date`（純日期）對齊 calendar-engine UTC 日界。
- 假日來源合併順序：內建範例固定日 + DB + 呼叫端自訂（union；假日優先於補班由 engine 處理）。
- migration 手寫但以 PGlite 實際套用驗證，降低「手寫 SQL 與 schema 漂移」風險。
- CI migration-check 與 build-test 分離，避免 DB 服務拖累純單元測試。
