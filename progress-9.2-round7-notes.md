# 9.2（#37）第 7 輪筆記（2026-06-10，自動排程）— 真實 client 完整重現 build-test 全綠，標記 done 交人類複查

## TL;DR
本輪以 **round6 的「假引擎」法在 sandbox 生成真實 Prisma client（35,776 行 d.ts，非 stub）**，於 main HEAD `b4e494b`（含修復 commit `7c62dd2`）**完整重現整個 `build-test` job 並全數綠燈**：
- `pnpm -r build`：apps/api `prisma generate && nest build` ✅、apps/web `tsc -b && vite build` ✅。
- `pnpm -r test`：apps/api jest **31 suites / 586 tests 全綠**、apps/web vitest **9 files / 101 tests 全綠（無 bus error）**。

這是繼 round6 後**第二次獨立重現 build-test 全綠**，且本輪未對程式碼做任何變更（純驗證）。據此將 #37 由 in-progress 改 done（不關閉，留人類複查）。

## 驗證方法（可複用）
```
npm config set prefix ~/.npm-global && export PATH=~/.npm-global/bin:$PATH
npm i -g pnpm@9.12.0
mkdir -p ~/fakeengine
touch ~/fakeengine/libquery_engine-debian-openssl-3.0.x.so.node
touch ~/fakeengine/schema-engine-debian-openssl-3.0.x
export PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
export PRISMA_QUERY_ENGINE_LIBRARY=~/fakeengine/libquery_engine-debian-openssl-3.0.x.so.node
export PRISMA_SCHEMA_ENGINE_BINARY=~/fakeengine/schema-engine-debian-openssl-3.0.x
export DATABASE_URL="postgresql://u:p@localhost:5432/db"
pnpm install --frozen-lockfile=false   # postinstall 的 prisma generate 會過（假引擎）
pnpm -r build   # 全綠
pnpm -r test    # 全綠（注意每個 bash 呼叫需重設上述 env，否則子程序拿不到，prisma 會去下載引擎被 403）
```

## 三 job 收斂判斷
- **build-test**：本輪真實 client 完整重現綠燈（見上）。修復 commit `7c62dd2` 已在 main。
- **migration-check / integration-test**：需真 Postgres + 真引擎，sandbox 無 root 無法跑；惟 round6 前已查得兩者 = success，且本次唯一變更為 spec 檔（`sales-engine.spec.ts`），結構上不可能影響 migration 或整合測試 → 不受影響。

## 本輪未證實項（環境限制，非實質風險）
本輪 `api.github.com` 對 `commits/<sha>/check-runs`、`actions/runs?...` 等讀取**一律回空 body**（與 round4/5 相同；round3/6 曾可讀），GitHub 連接器亦無 workflow-run / check-run 工具 → **無法在 sandbox 直接觀測 `b4e494b` 觸發的實際 CI run 結果**。此為觀測層限制，已由「人類複查後才關閉 issue」這道關卡涵蓋。

## 給人類複查者（關閉前 10 秒確認）
GitHub → Actions → main 最新 run（commit `b4e494b`，或對 `7c62dd2` 之後任一 run）→ 確認 **build-test / migration-check / integration-test 三 job 全綠**即可關閉 #37。若 build-test 意外仍紅，用上方「假引擎」法可於沙箱 ~5 分鐘重現並抓新錯誤。
