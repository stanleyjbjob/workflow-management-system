# 8.1 交付物補充（#33，後端 REST API 補齊 — ✅ 完成）

> 本檔為 8.1 第 3 批之進度紀錄（2026-06-07，自動排程輪）。因本輪 sandbox 限制無法安全重推完整 progress.md，**progress.md 主檔之 8.1 列與 Handoff 第 9/13/15 項尚未同步**，請下一輪（或人類）將本檔內容併入 progress.md 後刪除本檔。沿用 progress-6.2-notes.md / progress-7.1-notes.md 慣例。

## progress.md 應更新項（併入時）
- 表格列 8.1（#33）：🔄 進行中 → **✅ done**——第 1 批 projects（17 端點，`c2f00a1`）＋第 2 批四大流程（36 端點）＋**第 3 批 calendar/reminders（13 端點，commits `13bae4a`/`5e3b795`/`4e2a40b`）**皆已落地，七模組 REST 補齊完成。
- 「8.1 交付物」段標題改 ✅ 完成；「待續（下一輪接力）」一行以下方「第 3 批」內容取代。
- Handoff 第 9 項：8.1 已完成（所有模組 REST 已提供）；第 13 項：Holiday CRUD REST 已提供；第 15 項：已完成（實際權限見下）。

## 第 3 批內容（2026-06-07）
- `apps/api/src/calendar/calendar.controller.ts`（新增，`/calendar`，8 端點）：
  - Holiday CRUD（主管維護，§12-5）：`GET /calendar/holidays?from=&to=&type=`（workflow:read）、`POST /calendar/holidays`、`PATCH /calendar/holidays/:id`、`DELETE /calendar/holidays/:id`（後三者 **admin:manage**，僅 MANAGER；錯誤碼沿用 CalendarService：holiday_date_duplicate / holiday_date_invalid / holiday_name_required，查無→404）。
  - 行事曆查詢／遞延運算（DB 假日＋週末／補班＋專案排除日，workflow:read）：`GET /calendar/is-workday?date=&projectId=`、`GET /calendar/defer?date=&projectId=`（回 input/deferred/deferredDays）、`GET /calendar/next-workday?date=&projectId=`、`POST /calendar/reschedule`（純計算端點：anchor＋checkpoints＋mode=NEXT_WORKDAY|PUSH_FORWARD＋projectId＋custom 覆寫；引擎錯誤經 guardEngine 轉 400 保留 code）。
- `apps/api/src/reminders/reminders.controller.ts`（新增，`/reminders`，5 端點）：
  - 收件匣（本人）：`GET /reminders/inbox?unreadOnly=&take=`（case:read，recipient 固定＝登入者 user.sub）、`POST /reminders/inbox/:notificationId/read`（case:read，僅收件人本人可標已讀）。
  - 提醒：`GET /reminders/cases/:caseId/preview?now=`（case:read，previewReminderMessages 不派送不落地）、`POST /reminders/cases/:caseId/dispatch`（case:update，手動觸發 dispatchDueReminders；dedupKey 去重故重複觸發不重送；channels 可限定 IN_APP/EMAIL/OTHER）、`POST /reminders/sweep`（**admin:manage**，手動觸發 ReminderSchedulerService.runDailySweep 一輪全系統掃描、回傳 SweepSummary）。
- `ReminderService.markNotificationRead` 增加可選 `opts.recipientId`（向下相容）：限定僅收件人本人可標已讀，非本人視同查無（404，不洩漏通知存在性）。
- 模組接線：CalendarModule / RemindersModule 掛 controllers 並 imports RbacModule + AuthModule；兩處 index.ts 補 export。
- 驗證：兩個 controller＋兩個 module＋patched reminder.service 與**既有真實檔案**（calendar-engine / calendar.service / reminder-engine / email-dispatcher / smtp-transport / reminder-scheduler.service / engine-http）一起以 tsc 5.5.4（strict + noUnusedLocals/noUnusedParameters + experimentalDecorators）編譯，外部套件（@nestjs/* / @prisma/client / nodemailer）以最小 stub 供型別——**全綠（exit 0）**；推送後再以遠端 main 內容重新驗證一次仍全綠。真實 monorepo `pnpm -r build` 歸 9.2（#37）。

## 技術決策（8.1 第 3 批）
- **Holiday CRUD 寫入端點掛 `admin:manage`（僅 MANAGER）、查詢掛 `workflow:read`（全角色）**。理由：7.1（#31）已定案 Holiday 由主管維護；行事曆為平台基礎資訊，所有角色排程都需要查。（與 progress.md Handoff 第 15 項原建議「查詢 case:read」略有不同：行事曆非案件資料，採 workflow:read 更貼平台語意。）
- **收件匣端點不接受 recipientId 參數、一律以登入者為收件人；markNotificationRead 在服務層驗證收件人，非本人回 404**。理由：通知屬個人資料，避免越權查閱／標讀，404 不洩漏存在性。
- **全系統掃描 `POST /reminders/sweep` 掛 `admin:manage`、單案 dispatch 掛 `case:update`**（原建議 case:advance；dispatch 不推進流程狀態，case:update 語意較準）。理由：sweep 等同觸發每日 cron（跨所有案件寫入），屬管理操作；單案派送有 dedupKey 去重、影響面小，交給案件操作者即可。
