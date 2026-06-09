# 9.2（#37）第 3 輪重大更正 — GitHub Actions 實況

> 本檔更正第 2 輪「CI 自 6/07 未再觸發 / API push 不觸發 Actions」之研判。**該研判有誤。**

## 如何在 sandbox 讀到 CI 真實結果（關鍵方法，未來沿用）
- public repo 用未認證 `web_fetch` 取 commit 的 check-runs：
  `GET https://api.github.com/repos/stanleyjbjob/workflow-management-system/commits/<sha>/check-runs`
  → 回完整 JSON（三個 job 的 status/conclusion/job url）。
- 取某 check-run 的 annotation（**務必帶 query 參數，否則回空 body**）：
  `GET .../check-runs/<id>/annotations?per_page=50` → 回 annotation 陣列。
- ⚠️ 無效（回空 body）：`actions/runs/<id>/jobs`、`actions/jobs/<id>/logs`（需 auth）。故**完整 job log（含 tsc 錯誤明細）目前在 sandbox 讀不到**，需人類於 Actions 頁複製。

## 實況（commit 05e6df4 = 第 2 輪推送，run #27210971033，2026-06-09 13:52 UTC 實跑）
- **CI 確實有被 API push 觸發**（第 2 輪研判錯誤；run 在我方 push 後正常產生）。
- 三個 job 結果：
  - ✅ **migration-check = success**（prisma migrate deploy + db:seed 於真實 Postgres 全綠）
  - ✅ **integration-test = success**（prisma generate + migrate deploy + `test:integration` 真實 DB 全綠）
  - ❌ **build-test = failure**（唯一紅燈，annotation 僅「Process completed with exit code 1」）

## build-test 失敗的研判（待 log 證實）
- migration-check / integration-test 皆含 `pnpm install`（postinstall `prisma generate`）且成功 → **install 與 prisma generate 在 CI 正常**，故 build-test 失敗**不在 install**（annotation 的 line 106 錨點不可靠）。
- 時序：build-test 全程僅 **43 秒**（install+generate ≈ 32s，如 integration-test 所示），剩 ~11s → 失敗發生在 **build 階段**，即 `pnpm -r build` 的 **API `prisma generate && nest build`**（web build 本地僅 2s 且已驗證綠）。
- 最可能根因：**API 原始碼對「真實 generated Prisma client」存在型別不符（`nest build` 的 tsc 編譯錯誤）**，而前幾輪以「手寫 @prisma/client d.ts stub」typecheck 給了**假綠**（stub 把 delegate 設 `Promise<any>`，`data:{}` 欄位 typo / include-select 形狀 / `Prisma.JsonValue` 等錯誤抓不到）。
- 本地仍無法重現：sandbox `binaries.prisma.sh` 被擋（403），`prisma generate` 連 `--no-engine` 都失敗；`npm pack @prisma/engines@5.22.0` 取得的 tarball **不含引擎二進位**（僅下載腳本），故無法在 sandbox 生成真實 client 來跑 `nest build`。

## 下一步（handoff）
1. **請人類於 Actions → run #27210971033（或最新一筆）→ build-test job → 展開 `Build`（`pnpm -r build`）步驟**，把 `nest build` 報出的 TS 錯誤（檔名:行號 + TSxxxx 訊息）貼回 #37。有了明細，下一輪即可精準修 API 原始碼對 generated client 的型別不符。
2. 修正後本地無法跑 `nest build` 驗證（client 生不出來），故修正須以「對照 schema.prisma 真實欄位 + generated client 慣例」推導，並**靠 CI 的 build-test 轉綠**確認。
3. 三個 job 全綠後即達 #37 驗收，可標 done。
4. （次要）Actions 已警告 Node 20 將於 2026-06-16 停用；非當前失敗主因，可日後將 actions/setup-node 等升至支援 Node 24 的版本。
