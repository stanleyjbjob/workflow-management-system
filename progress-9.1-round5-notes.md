# 9.1 服務層整合測試（#36）— 第 5 輪 notes（2026-06-09，自動排程）

> 沿用 progress-X.Y-notes.md 增量慣例。本輪 **未新增/未修改任何測試或程式碼**（repo 自上輪 commit `361127b` 後無變更），
> 工作內容為「獨立靜態驗證 + 釐清唯一未結項」。

## 本輪結論
- 整測撰寫面 **五塊皆已落地且齊備**：forms / workflow / kanban / iso-trail / projects（commits 截至 `6b536b8` / `361127b`）。
- 唯一未結項仍是驗收要點①「整合測試可在 CI 啟動 DB 並通過」之 **CI `integration-test` job 綠燈人工確認**。
  - sandbox 結構性限制不變：`binaries.prisma.sh` 仍被網路 allowlist 擋（403）→ 無法 `prisma generate`；無 root → 無法裝 Postgres；故 **本地無法實跑整測**。
  - 此環境對 GitHub Actions「job 級 / check-runs 小 JSON」endpoint 取回空 body → 無法在 sandbox 判定 job 紅綠（已連續多輪相同）。

## 本輪實際做的驗證（stub-tsc 抓不到的殘留風險）
針對「Prisma `data:` / `where:` 欄位名與 enum 值是否對齊 `schema.prisma`」這一類 stub-based tsc 無法捕捉的 bug，做了獨立交叉比對：
- **欄位名**：以腳本解析 `schema.prisma` 各 model 欄位＋關聯集合，逐一比對 5 個 `*.int-spec.ts` 中所有 `prisma.<delegate>.<op>({ data/where })` 的頂層 key → **全部命中 schema，無越界欄位**。
- **enum 值**：specs 以字串字面量帶入 enum 欄位（`status` / `flowType` / `type` / `eventType` / `fieldType` / `code` 等），逐一核對：
  - `StepInstanceStatus`(PENDING/IN_PROGRESS/COMPLETED)、`CaseStatus`(IN_PROGRESS/COMPLETED)、`SubmissionStatus`(SUBMITTED/APPROVED)、`FlowType`(SALES/ONBOARDING)、`AttachmentType`(FILE)、`AuthEventType`(LOGIN_SUCCESS)、`FieldType`(TEXT/TEXTAREA/NUMBER)、`RoleCode`(SALES) → **全部為合法 enum 成員**。
- CI `integration-test` job 設定再核（`.github/workflows/ci.yml`）：postgres:16 service + 獨立 `wfms_test` DB + `prisma migrate deploy` → `pnpm --filter @wfms/api run test:integration`（`jest --config jest.integration.config.js --runInBand`），testRegex 自動納入 5 個 int-spec，設定正確。

> 結論：撰寫面與 schema 一致性在靜態層級已高度可信；剩下只差「真 DB 上實跑」這一步的綠燈確認。

## 給人類的單步動作（解除此 issue 的唯一關卡）
1. 開 Actions → 最近一次 `CI`（main, 最新 commit `361127b`）→ 看 **`integration-test`** job 是否綠。
   - 直達：`https://github.com/stanleyjbjob/workflow-management-system/actions`（篩 workflow=CI，job=integration-test）。
2. 若 **綠** → #36 驗收要點全達成，可將 #36 由 in-progress 改 done（留人類關閉）。
3. 若 **紅** → 貼該 job 失敗訊息到 issue；多半是某欄位/關聯名稱或 enum 細節與 schema 不符（本輪已靜態排除頂層欄位/enum，故較可能是巢狀 create 欄位、唯一鍵衝突、或 migrate deploy 問題），下一輪據訊息修。
   - 注意：整體 CI 另有 `build-test` job（含 web 套件 `pnpm -r test`）可能獨立紅，與 9.1 標的不同，**只需看 `integration-test` job 本身**。

## 狀態
🔄 未完成（保留 in-progress）。非因撰寫缺口，而是驗收要點①需 CI job 級綠燈，sandbox 無法取得。建議由人類做上述單步確認後收尾。
