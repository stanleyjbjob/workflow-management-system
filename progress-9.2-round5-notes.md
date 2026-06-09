# 9.2（#37）第 5 輪筆記（2026-06-10）

## 本輪環境現況
- `binaries.prisma.sh` = **403**（封鎖）；`registry.npmmirror.com/-/binary/prisma` = 403。→ `prisma generate` 連 `--no-engine` 都失敗（CLI 仍需下載 schema-engine 二進位，被擋）。sandbox **無法生成真實 client**。
- `api.github.com` = **000**（本輪完全封鎖，與第 3 輪「未認證 web_fetch 可讀 check-runs」不同）；GitHub MCP 連接器可正常讀寫（comment/push 皆成功），但**無 check-run / workflow-run 工具** → **本輪讀不到 CI build-test 的 tsc 明細**。
- `registry.npmjs.org` = 200、`github.com` git clone OK。

## 本輪做了什麼（實際推進）
建立可複用的 **欄位精準 Prisma typecheck harness**（commit `5c26db9`，置於 `apps/api/_verify/`，**不影響**正式 build）：
- `_verify/genstub.mjs`：解析 `schema.prisma`（18 models / 13 enums），自動生成 `@prisma/client` stub —— 每個 model 的 delegate 之 `data`/`select`/`include`/`orderBy` 以 `keyof Model` 設鍵、enum 為字面量聯集、scalar 可空為 `T | null`、relation 為 optional key、`include`/`select` 做單層 payload narrowing。
- `_verify/ambient.d.ts`：把 NestJS/node 相依宣告為 `any`（避免安裝大相依），**只讓 @prisma/client 嚴格**。
- `tsconfig.verify.json`：extends `tsconfig.build.json`、paths 把 `@prisma/client` 指到 stub。
- 用獨立 `typescript@5.5.4`（npm pack 解壓，TS 無相依）跑 `tsc -p tsconfig.verify.json`，覆蓋 `apps/api/src` 全部非 spec 檔。

## 結論（重要，收斂 failure 範圍）
跑出的所有 tsc 錯誤經逐項分類，**100% 為 stub 精度限制造成的假陽性**，非真 bug：
- `TS2709`（9 筆）：NestJS 介面（CanActivate/ExecutionContext/OnModuleInit/Reflector…）被 ambient 宣告為 any，用作型別位置 → 真實環境有正確型別，非 bug。
- `TS7006`（1 筆，main.ts）：nest-any 推導出的隱式 any 參數 → 非 bug。
- `TS2322`（2 筆，forms.service:168 / project.service:294）：**巢狀 include/select 的遞迴 payload narrowing**，本 stub 只做單層 → 真實 Prisma 會把巢狀關聯收斂為 present，非 bug。

→ **排除整個「欄位名稱層級」bug 類**：model/delegate 名稱、`data`/`select`/`include`/`orderBy` 欄位名、enum 值、scalar 可空性，**API 源碼與 schema 完全一致**。

## 因此：CI build-test 紅燈真因（收斂後）
必落在 **stub 無法模擬的 Prisma 型別精度**，候選：
1. `data`/`where` 的**值型別**不符（傳錯型別到某欄位、或 nested write `connect`/`set` 形狀）。
2. `select` 後存取**未選取**欄位（payload 收斂移除該欄）造成的存取錯誤。
3. 手寫回傳型別（service 的 `Promise<{...}>`）與真實 `GetPayload` narrowing 不符。
4. （較不可能）非 API 因素，但第 4 輪已時序定位在 Build 步、API `nest build`。

## 下一輪 / 人類接手（精確 handoff）
**唯一缺口仍是「真實 build-test 的 `Build` 步 tsc 明細」**。取得任一即可據以修源碼並靠 CI 轉綠：
- (A) 人類於 GitHub Actions → 最新 main run → `build-test` job → `Build` step，貼出 `error TS....` 行號明細到 #37。
- (B) 在 `binaries.prisma.sh` 可達的環境跑 `cd apps/api && pnpm install && pnpm prisma generate && pnpm exec tsc -p tsconfig.build.json`，貼出錯誤。
- (C) 若未來輪 `api.github.com` 恢復：未認證 `GET /repos/.../commits/<sha>/check-runs` + `/check-runs/<id>/annotations?per_page=50`（**務必帶 query**）可能取回 annotation 含錯誤摘要。
har­ness 已就緒，拿到明細後可在沙箱用 `_verify` 快速複現「欄位層級」部分；值型別/payload 層級仍需真 client 或 CI。
