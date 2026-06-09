# 9.2（#37）第 4 輪紀錄（2026-06-09，自動排程）

## TL;DR
程式面連續第 4 輪本地全綠、無回歸。本輪**進一步縮小 build-test 失敗範圍**：已逐一排除「與 Prisma generated client 無關」的 strict 編譯錯誤來源，確認紅燈**純粹來自 API 原始碼對真實 generated `@prisma/client` 的型別不符**（delegate 的 include/select/where/data 形狀）。**唯一缺口仍是「人工貼出 build-test 的 `Build` 步驟 tsc 錯誤明細」**——這是現有沙箱與連接器工具都拿不到的資訊。狀態：🔄 未完成。

## 本輪確認的環境硬限制（與第 1–3 輪一致，再次驗證）
1. **沙箱無法生成 Prisma client**：`prisma generate --no-engine`（含 `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1`）仍因 `binaries.prisma.sh` → **403 Forbidden**（schema-engine.gz）而失敗。→ API 的 `pnpm -r build`（`prisma generate && nest build`）只能在 GitHub Actions 跑。
2. **沙箱無法讀 GitHub Actions 結果**：本輪 `api.github.com` 連線實測 = **000（封鎖）**，`web_fetch` 對 check-runs API 回空 body。第 3 輪曾用的「未認證 web_fetch 讀 check-runs」本輪**不可用**。
3. **GitHub 連接器無讀取 workflow run / check-run 的工具**：唯一相關為 `get_pull_request_status`，需先有 PR 且**只回 pass/fail 結論、不含 tsc 錯誤明細**。即使開 PR 也無法取得修 build 所需的錯誤行號 → 故本輪維持「不自動開 PR」。

## 本輪新增的縮小範圍工作（排除環境無關錯誤）
逐項掃描 `apps/api/src`（build-test 的 `nest build` 會編譯整棵 src，`*.spec.ts` 已 exclude）：
- **catch 區塊**（strict `useUnknownInCatchVariables`）：calendar.service / common/engine-http / attachments.service / attachments-engine / templates.service 等所有非 spec catch，**皆在使用前以 `instanceof` 收斂**（含 `Prisma.PrismaClientKnownRequestError`），無 `'e' is of type 'unknown'` 類錯誤。→ 第 1–3 輪 jest 看到的 `'e' is of type 'unknown'` 確實是「缺 client 使 `Prisma` namespace 不存在」的衍生效應，client 生成後即消失。
- **process.env 直接取用**：main.ts / auth.config.ts 皆有 guard，無 strict 風險。
- **Json 欄位**（schema 只有 `FormField.options Json?`、`FormSubmission.data Json`）：`forms.service.ts` 寫入/讀出已用 `as never` / `as Record<string, unknown>` 顯式轉型 → **Json 欄位不是肇因**（轉型會吸收型別差異）。

### 結論：紅燈來源已收斂
build-test 失敗**不在** install / prisma generate（migration-check、integration-test 兩個 job 都含 `pnpm install`＋`prisma generate` 且為 success）、**不在** web build（本地已驗證綠）、**不在** 環境無關的 strict 錯誤（本輪已掃除）。→ **必為 API 原始碼對真實 generated client delegate 的型別不符**：最可能是某些 `findX/create/update` 的 `include`/`select`/`where`/`data` 形狀，或關聯欄位未 include 卻被存取。前幾輪以手寫 stub（delegate = `Promise<any>`）typecheck，這些形狀錯誤被吃掉成假綠。

## 下一步（handoff，給人類 — 維持精簡）
1. 到 **Actions → 最新一筆 `CI` run → `build-test` job → 展開 `Build`（`pnpm -r build`）步驟**，把 `nest build` 報出的 TS 錯誤（**檔名:行號 + TSxxxx 訊息**，全部）貼回 #37。
2. 有了明細，下一輪即可精準修 API 對 generated client 的型別不符；修正須對照 `apps/api/prisma/schema.prisma` 真實欄位推導，並靠 CI build-test 轉綠確認（沙箱仍生不出 client）。
3. 三個 job 全綠後即達 #37 驗收，留待人類複查後標 done／關閉。
4. （次要、非當前肇因）Actions 已警告 Node 20 將於 2026-06-16 停用，可日後升級 `actions/setup-node`。

狀態：🔄 未完成（保留 in-progress label）。
