# 9.2（#37）第 6 輪筆記（2026-06-10，自動排程）— 重大突破：找到並修復 build-test 真因

## TL;DR
**5 輪以來首次能在 sandbox 生成真實 Prisma client 並完整重現 CI `build-test` job。** 真因不是「API 源碼對 generated client 型別不符」（前 5 輪的研判錯誤），而是 **`pnpm -r test` 步驟**裡 `apps/api/src/sales/sales-engine.spec.ts:123` 的一個 **ts-jest 編譯錯誤（TS2352）**——對一個缺 `saleMode` 的 partial 物件做 `as OpportunityInput` 斷言。修法＝移除該不必要的斷言（commit `7c62dd2`）。本地完整重現整個 build-test job（API build+test、web build+test）**全綠**。

## 關鍵突破：sandbox 生成真實 Prisma client 的方法
`binaries.prisma.sh` 仍 403（封鎖），但 **`prisma generate` 不需要引擎二進位即可產出 client 的 `.d.ts`**（DMMF 由 npm 內附的 WASM schema parser 解析；引擎只是 runtime 才需要）。CLI 預設會「download-check」引擎而卡住，繞法：
```
export PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
mkdir -p ~/fakeengine
touch ~/fakeengine/libquery_engine-debian-openssl-3.0.x.so.node
touch ~/fakeengine/schema-engine-debian-openssl-3.0.x
export PRISMA_QUERY_ENGINE_LIBRARY=~/fakeengine/libquery_engine-debian-openssl-3.0.x.so.node
export PRISMA_SCHEMA_ENGINE_BINARY=~/fakeengine/schema-engine-debian-openssl-3.0.x
export DATABASE_URL="postgresql://u:p@localhost:5432/db"
prisma generate   # OK，index.d.ts 約 35,775 行（真實，非 110 行 placeholder）
```
產出的 client 僅供 **tsc / ts-jest 型別檢查**用（無引擎，不能真連 DB；DB 整合測試仍靠 CI 的 postgres job）。

## 完整本地重現結果（＝CI build-test job）
在 `apps/api` 用 `npm install --ignore-scripts`（593 套件）+ 上述 client 生成後：
- `nest build`（= `tsc -p tsconfig.build.json`）：**0 error**（推翻前 5 輪「API 源碼對 client 型別不符」假設——源碼其實乾淨）。
- `jest`（全 31 suites）：**修前 1 suite 編譯失敗（TS2352）/ 30 綠；修後 31/31 綠、586 tests pass**。
在 `apps/web` 用 `npm install`（97 套件）後：
- `tsc -b && vite build`：**OK**
- `vitest run`：**9 files / 101 tests 綠**

-> `pnpm -r build` 綠、`pnpm -r test` 綠 -> **build-test job 應轉綠**。migration-check / integration-test 前幾輪已 success，未受本次變更影響。

## 為何前 5 輪沒抓到
sandbox 生不出 client -> jest 根本跑不起來（`Prisma namespace` 衍生錯誤），這個**與 Prisma 無關**的 spec 編譯錯誤被完全遮蔽。前幾輪「抽樣 9 suites 綠」未涵蓋 sales-engine.spec；且時序分析誤把失敗定位在 build 步。

## 本輪變更
- commit `7c62dd2`：`apps/api/src/sales/sales-engine.spec.ts` — 移除第 123 行 `} as OpportunityInput),` 的 `as OpportunityInput`（helper `validOpportunity(over: Partial<OpportunityInput>)` 本就回傳完整物件並預設 `saleMode: PURCHASE`，該斷言多餘且非法）。語意不變。

## 狀態 / handoff
仍標 in-progress（保守）。**唯一未證實項＝實際 CI run 是否綠**：本輪 `api.github.com` = 000（封鎖）、無 check-run MCP 工具 -> 無法在 sandbox 觀測 commit `7c62dd2` 觸發的 CI 結果。
下一輪 / 人類只需：確認 main 最新 run（commit `7c62dd2`）的 **build-test / migration-check / integration-test 三 job 全綠**，即達 #37 驗收 -> 移 in-progress、加 done（留人類關閉）。若 CI 仍紅，用上方「假引擎」法在 sandbox 可 5 分鐘重現並抓新錯誤。
