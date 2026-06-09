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
