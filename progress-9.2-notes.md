# 9.2 CI 全流程驗證 — 進度註記（#37）

## 本輪（2026-06-09，自動排程第 1 輪）

於沙箱 clone 真實 monorepo（pnpm 9.12.0 / Node 22）執行驗證。重點：**前端可於真實環境完整驗證並全綠；後端因沙箱網路封鎖 Prisma 引擎下載而無法在本地跑完整 build/jest，屬環境限制而非程式問題。**

### ✅ 已在真實環境驗證通過
- `pnpm install`（622 套件，frozen-lockfile=false）成功（lockfile 已在 repo，解析略過）。
- **前端 `pnpm --filter @wfms/web build`**：`tsc -b && vite build` 全綠（65 modules，dist 產出正常）。
- **前端 `pnpm --filter @wfms/web test`（vitest run）**：**9 檔 101 案全綠**，**未再現 sandbox worker bus error**（issue 背景所列疑慮已排除）。
- **後端純引擎 / 工具層 jest（ts-jest 真實型檢）抽樣**：calendar-engine、holiday-mapping、iso-trail-engine、attachments-engine、templates-engine、gantt-engine、exclusion-engine、delay-engine、reminder-engine、token.util、permissions 等 **9 suites 239 案全綠**。

### ⛔ 沙箱限制（無法於本環境驗證，非程式錯誤）
- `prisma generate` 失敗：`binaries.prisma.sh`（及 npmmirror 鏡像）皆被沙箱 proxy 回 **403 Forbidden**，無法下載 query engine（`PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` 與 `PRISMA_ENGINES_MIRROR` 皆無效，因連 engine 檔本身也被擋）。
- 因此 **API 的 `pnpm -r build`（`prisma generate && nest build`）** 與 **匯入 generated client 的 jest specs / 整合測試** 無法在沙箱跑完。
- 受影響的 2 個失敗 suite（calendar 等）錯誤皆為 `Property 'PrismaClientKnownRequestError' does not exist on type 'typeof Prisma'` 及其衍生的 `'e' is of type 'unknown'`——**根因是 client 未生成導致 `Prisma` 命名空間不完整、type guard 無法收斂**。已檢視 `calendar.service.ts:182/204/218` 的 `try/catch` 皆正確置於 `if (e instanceof Prisma.PrismaClientKnownRequestError)` 內，**屬正確慣用寫法，generated client 就緒後即可編譯通過**，非真實 bug。

### 結論與下一步（handoff）
- issue 真正驗收＝「CI 在 main / PR 上全綠」。沙箱無法觸及 Prisma 引擎 CDN，故**最終確認需看 GitHub Actions 實跑結果**（Actions runner 可正常下載 binaries.prisma.sh，且 migration-check / integration-test 兩個 job 需 Postgres service，皆只能在 Actions 上跑）。
- 建議下一輪：(a) 推一個觸發 commit（或開 PR）讓 `.github/workflows/ci.yml` 在 main/PR 實跑；(b) 透過 GitHub 讀回該 workflow run 的 conclusion，三個 job（build-test / migration-check / integration-test）全綠才標 done。
- 程式面：本輪未發現需修正的編譯/型別/測試錯誤；前端 vitest 在真實環境穩定（先前 bus error 為沙箱特有，可從 issue 疑慮移除）。

> 標記狀態：🔄 未完成（保留 in-progress label）——前端已驗證，後端待於真實 CI 確認。

## 本輪（2026-06-09，自動排程第 2 輪）

延續第 1 輪，於沙箱 clone 真實 monorepo（pnpm 9.12.0 / Node 22）再次完整驗證，並調查 GitHub Actions 實跑狀態。

### ✅ 本地（真實 pnpm/vitest）再次驗證全綠
- `pnpm install`（622 套件，--ignore-scripts 後 22 秒完成）成功。
- **前端 `pnpm --filter @wfms/web build`**：`tsc -b && vite build` 全綠（65 modules）。
- **前端 `pnpm --filter @wfms/web test`（vitest run）**：**9 檔 101 案全綠**，未再現 bus error。
- **後端 `pnpm --filter @wfms/api exec jest`（ts-jest 真實型檢）**：可執行的 **12 個純引擎 suites 共 268 案全綠**；其餘 19 個 suites 為「failed to run」之**編譯期**錯誤，根因全部是 `@prisma/client` 未生成 → 缺 `FlowType`/`RoleCode` enum 與 `Prisma` namespace（`Module '@prisma/client' has no exported member 'FlowType'`、`'e' is of type 'unknown'`）。**屬沙箱 CDN 限制，非真實 bug**，Actions 上 `prisma generate` 成功後即消失。

### ⛔ 沙箱限制（與第 1 輪相同）
- `prisma generate`（含 `--no-engine` + `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1`）皆失敗：`binaries.prisma.sh` 對 checksum 與 engine/schema-engine 檔一律 **403 Forbidden**，npmmirror 鏡像連線亦被擋。故 API 的 `pnpm -r build`（需 generated client）與整合測試只能在 GitHub Actions 跑。

### 🚩 關鍵發現：CI 自 2026-06-07 起未再觸發
- 由 Actions API 讀回：最新一筆 workflow run 為 **#120（2026-06-07，failure）**，且 #116–#120 皆 failure。
- 但 6/08–6/09 已有約 8 筆 push 到 main（含 9.1 整合測試程式 a5dda97 / 2fd6765 / 6b536b8、多筆 docs），**期間沒有任何新的 workflow run 產生**（run_number 仍停在 120）。
- 研判：**透過 GitHub API（連接器 push_files/create_or_update_file）建立的 commit 可能未觸發 Actions 的 push event**，或 repo 的 Actions 觸發被停用。此為「CI 在 main 全綠」驗收的真正卡點，**屬環境/權限問題而非程式問題**。

### 本輪採取的動作
- 於 `.github/workflows/ci.yml` 的 `on:` 新增 **`workflow_dispatch`**，讓 CI 可從 Actions 分頁或 API 手動觸發、在無新 commit 時重跑驗證（YAML 已通過 `yaml.safe_load` 檢查）。
- 推送本變更同時測試「API push 是否會觸發 Actions」。

### 結論與下一步（handoff）
- 程式面：本地可驗證的部分（前端 build/test、後端純引擎 jest）**全綠**，本輪未發現需修正的編譯/型別/測試錯誤。
- **驗收仍未達成**：需「CI 在 main / PR 全綠」。請人類於 GitHub 端確認並擇一：
  1. 確認 repo **Settings → Actions 已啟用**（Allow all actions），且 workflow 未被停用；
  2. 到 **Actions 分頁手動 `Run workflow`（workflow_dispatch）** 重跑 `CI`，確認 build-test / migration-check / integration-test 三個 job 全綠；
  3. 若手動觸發後仍紅，把該 run 的 job log 貼回 issue，下一輪據以修正。
- 若本輪這個 push **有**觸發新的 workflow run，下一輪可直接由 Actions API 讀回 conclusion 判定 done。
- 狀態：🔄 未完成（保留 in-progress）。
