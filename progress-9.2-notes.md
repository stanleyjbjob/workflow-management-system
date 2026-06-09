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

## 本輪（2026-06-09，自動排程第 3 輪）

延續第 1、2 輪，於沙箱 clone 真實 monorepo（pnpm 9.12.0 / Node 22）對**最新 HEAD（05e6df4）**再次完整驗證；本輪重點放在「排除真實程式 bug」與「釐清剩餘卡點」。

### ✅ 本地（真實 pnpm / vite / vitest / jest）再次驗證全綠（無回歸）
- `pnpm install --frozen-lockfile=false --ignore-scripts`（622 套件，~23 秒）成功。
- **前端 `pnpm --filter @wfms/web build`**：`tsc -b && vite build` 全綠（65 modules）。
- **前端 `pnpm --filter @wfms/web test`（vitest run）**：**9 檔 101 案全綠**，未再現 bus error。
- **後端 `pnpm --filter @wfms/api exec jest`**：**12 個純引擎 suites 共 268 案全綠**；其餘 19 個 suites 為「failed to run」之**編譯期**錯誤，根因全部是 `@prisma/client` 未生成（`Module '@prisma/client' has no exported member 'FlowType'` / `'RoleCode'`、衍生 `'e' is of type 'unknown'`）。與第 1、2 輪完全一致，**非回歸、非真實 bug**。

### ✅ 進一步佐證「generated client 就緒後即可編譯通過」
- 檢視 `apps/api/prisma/schema.prisma`：**已定義** `enum FlowType { SALES ONBOARDING ENVIRONMENT CUSTOMIZATION }` 與 `enum RoleCode { MANAGER SALES CONSULTANT ENG_LEAD ENGINEER ASSISTANT }`。→ `prisma generate` 成功後 `@prisma/client` 必會輸出這兩個 enum 與完整 `Prisma` namespace，19 個 suites 的編譯錯誤即消失。
- 確認 CI 設定無 script/設定層級 bug：`apps/api/package.json` 的 `build`(`prisma generate && nest build`)、`test`(`jest`)、`db:seed`、`test:integration`、`postinstall`(`prisma generate`) 皆存在；jest 單元設定（`jest.config.js`，`rootDir=src`、`*.spec.ts`）與整合設定（`jest.integration.config.js`，`test/integration/*.int-spec.ts`）**正確分流**——`build-test`（無 DB）跑的 `pnpm -r test` 只會撈到 31 個單元 spec，不會誤觸需 DB 的 5 個 int-spec。

### ⛔ 沙箱限制（再次確認，與前兩輪相同）
- 連線測試：`registry.npmjs.org` → 200、`github.com` → 200、**`binaries.prisma.sh` → 000（封鎖）**。
- `prisma generate --no-engine`（含 `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1`）與 `prisma validate` 皆因 `binaries.prisma.sh` **403/封鎖**而失敗；npm 套件內僅含 wasm 引擎（`query_engine_bg.postgresql.wasm`），native 5.22 client 生成仍須下載被擋的 query/schema-engine。→ **沙箱無法生成 Prisma client 是硬限制，API build / 含 client 之 jest / 整合測試只能在 GitHub Actions 跑。**

### 為何本輪未開 PR / 未自動觸發判定
- GitHub 連接器**未提供讀取 workflow run（Actions runs）的工具**；唯一與 CI 狀態相關的是 `get_pull_request_status`（需先有 PR）。
- 但本排程規則明定「**不自動開 PR**，除非 issue 明確要求」，#37 未要求開 PR，故本輪不開 PR。→ 代表**自動排程在現有工具與規則下，無法自行觀測 main 的 CI 結論**，此驗收步驟必須由人類完成。

### 結論與下一步（handoff，給人類）
- 程式面：連續 3 輪本地驗證**全綠且無回歸**，未發現需修正的編譯/型別/測試錯誤；schema 已含必要 enum，CI 設定無 script/分流 bug。**程式面已就緒。**
- **驗收仍卡在「需人工於 GitHub 端確認 CI 結果」**，請擇一處理：
  1. **Settings → Actions → General** 確認為「Allow all actions and reusable workflows」，且 `CI` workflow 未被停用（若顯示 disabled，按 Enable）。
  2. 到 **Actions 分頁 → 選 `CI` → Run workflow（workflow_dispatch，第 2 輪已加）** 手動觸發於 `main`，確認 **build-test / migration-check / integration-test** 三個 job 全綠。
  3. 若仍有紅燈，把該 job log（特別是 `prisma generate`、`pnpm -r build`、`prisma migrate deploy`、`test:integration` 段）貼回本 issue，下一輪即可據實 log 修正真實問題。
  4. 若三個 job 全綠，可直接由人類複查後將 #37 標 `done` 並關閉（或留給下一輪在能讀到綠燈時收尾）。
- 狀態：🔄 未完成（保留 in-progress）。
