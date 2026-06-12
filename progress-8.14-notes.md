# progress 8.14（#49）假日維護 UI（/calendar/holidays，MANAGER）

完成日期：2026-06-12（自動排程，單輪完成）

## 落地內容

新增 `apps/web/src/features/holiday-admin/`（沿用既有 feature 結構：型別鏡像／api／純邏輯／View／Page／index／tests）：

- `types.ts`：`HolidayRecord` 鏡像後端 Prisma Holiday（date 為 UTC 午夜 ISO 字串）；type/source 以 string 容忍未知值。
- `api.ts`：`fetchHolidays / createHoliday / patchHoliday / deleteHoliday` 對應 `GET/POST/PATCH/DELETE /calendar/holidays`；`holidayQuery` 純函式組 query（from/to/type，空值不送）。
- `holiday-admin-view.ts`（純邏輯，vitest 直測）：
  - `defaultFilter`：當年度全年（UTC 日界，與後端 toIsoDate 一致）；`yearRange`、`toHolidayQuery`。
  - `validateDraft`：鏡像後端錯誤碼於送出前就地擋（`holiday_date_invalid`：格式＋真實日期回驗（防 02-30 引擎進位差異）；`holiday_name_required`：trim 後必填）；note 空字串 → null。
  - `writeErrorMessage`：issue 驗收三錯誤碼＋`forbidden` → 中文提示，其餘 fallback。
  - `typeLabel / sourceLabel / isoDateOf / emptyDraft / draftFromRecord`。
- `HolidayAdminView.tsx`：過濾列（年度快選＋起迄日期＋類型）→ 新增表單卡 → 清單表格（列內編輯／刪除）；busy 時停用寫入按鈕防重複送出；寫入錯誤顯示於新增卡下方。
- `HolidayAdminPage.tsx`：容器（IsoTrailPage 同模式）＋取數序號防競態（TaskKanbanPage 慣例）；寫入成功後重抓清單；刪除前 window.confirm。
- `App.tsx`：新增「假日維護」tab，**僅 `isManager(currentUser)` 顯示**；render 亦再驗一次。後端 `admin:manage`（僅 MANAGER）為最終權威，403 經 `writeErrorMessage('forbidden')` 顯示提示。

## 技術決策

1. **入口放主導覽 tab 而非獨立「設定區」**：現有 App 尚無設定區結構，單頁需求自建設定殼層過度設計；以 MANAGER 條件 tab 呈現，未來有第二個設定頁再抽殼。
2. **前端預先驗證鏡像後端錯誤碼**：date/name 錯誤在送出前就地擋下（同一套 `writeErrorMessage` 文案），後端 400 仍為權威（duplicate 唯一鍵衝突僅後端可判）。
3. **無 onlyMine／角色過濾**：清單為全域資料（行事曆本質全公司共用），讀取全角色皆可（workflow:read），寫入僅 MANAGER。
4. **不做樂觀更新**：寫入成功後重抓（資料量小、一致性優先），與 8.10/8.13 慣例一致。

## 驗證

- `pnpm --filter @wfms/web build`（tsc -b＋vite）✅
- `pnpm --filter @wfms/web test`：**23 files / 220 tests 全綠**（8.13 後基準 21/203，+2 檔 +17 案）。
- 「變更後看板遞延標示與排程遞延同步生效」由後端 DB 驅動架構保證（kanban/reminder 皆經 CalendarService.loadCalendar 讀 Holiday 表），無前端工作。

## 佇列現況

8.x 前端串接全數完成。open 佇列僅剩 #38（10.1 業務規則定案追蹤，刻意不掛 in-progress、留人類定案）。
