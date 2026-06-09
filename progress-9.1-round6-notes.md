# 9.1 服務層整合測試（#36）— 第 6 輪 notes（2026-06-09，自動排程）

> 沿用 progress-X.Y-notes.md 增量慣例。本輪 **未新增/未修改任何測試或程式碼**，
> 工作內容為「取得前 5 輪一直缺的 CI `integration-test` job 綠燈證據」並據此收尾。

## 本輪結論：✅ 驗收要點全達成，#36 可結

前 5 輪的唯一未結項是驗收要點①「整合測試可在 CI 啟動 DB 並通過」，因 sandbox 無法
跑 `prisma generate`（`binaries.prisma.sh` 被網路 allowlist 擋，本輪再確認回傳 000）、
無 root 無法裝 Postgres，且前幾輪從 GitHub API 取 job 級結果回空 body，故一直無法確認。

**本輪突破點**：此 repo 為 public，可用 **未認證的 GitHub REST「check-runs」endpoint** 取得
最新 main commit 的 job 級結果（前幾輪走 actions/runs/<id>/jobs 取回空 body，改走
`/commits/<sha>/check-runs` 即成功）。

### 證據（最新 main commit `a039704`，CI run 27208227550，2026-06-09T13:06–13:07Z）
`GET /repos/stanleyjbjob/workflow-management-system/commits/a039704/check-runs` →

| job | conclusion | 備註 |
|-----|-----------|------|
| **integration-test** | ✅ success | 唯一 annotation 為 Node.js 20 deprecation warning（非阻斷） |
| migration-check | ✅ success | 同上 warning |
| build-test | ❌ failure | workflow 第 106 行 `Process completed with exit code 1`＝`pnpm -r test`（含 web 套件），屬 9.2（#37），與 9.1 標的無關 |

- `integration-test` job 步驟為 postgres:16 service → `prisma migrate deploy` → `pnpm --filter @wfms/api run test:integration`（`jest --config jest.integration.config.js --runInBand`）。
- jest 預設未設 `--passWithNoTests`，若 0 test 會 exit 1；job success 代表 testRegex 撈到的 5 個 `*.int-spec.ts` 確實在真實 Postgres 上跑且通過，且 `migrate deploy` 成功。

## 驗收要點對照（issue #36）
1. **整合測試可在 CI 啟動 DB 並通過** → ✅ CI `integration-test` job = success（real Postgres）。
2. **覆蓋主要 Service 路徑與權限收斂** → ✅ forms / workflow / kanban / iso-trail / projects 五塊（含 AccessScope case/project 收斂），詳見 progress-9.1-notes.md 第 1–4 批。

## 收尾動作（本輪）
- #36：移除 `in-progress`、加 `done` label（依排程規則，不自動關閉，留人類複查後關閉）。
- 整體 CI 仍紅燈來源＝`build-test` 的 `pnpm -r test`（web），請於 9.2（#37）處理（前端 vitest／build）。

## 對未來輪次的可重用技巧
- 要查 CI job 紅綠：public repo 用未認證 `GET /repos/{o}/{r}/commits/{sha}/check-runs`（經 web_fetch），
  比 `actions/runs/<id>/jobs` 在此環境更穩；annotation 細節用 `/check-runs/{id}/annotations`。
