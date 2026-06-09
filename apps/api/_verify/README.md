# _verify — sandbox 用 Prisma 欄位精準 typecheck harness（#37 9.2）

## 目的
本機/沙箱因 `binaries.prisma.sh` 被網路 allowlist 擋（403），無法 `prisma generate`，
因此無法用「真實 generated client」對 `apps/api/src` 跑 `nest build` tsc。
此 harness 以 **由 `schema.prisma` 自動生成的欄位精準 @prisma/client stub** 取代，
讓 tsc 能在**不安裝 NestJS/node 相依**下，靜態檢查 API 源碼對 Prisma 的用法。

## 能抓到什麼（高信心）
- delegate / model 名稱錯誤
- `data` / `select` / `include` / `orderBy` 的**欄位名**錯字（keyed by `keyof Model`）
- enum 值錯誤、scalar 可空性（`T | null`）

## 抓不到（stub 精度限制，非 bug）
- Prisma 精確 input **值型別**（data 值一律 any，避免 nested write/operator 假陽性）
- `where` 形狀（一律 any）
- `include`/`select` 的**遞迴 payload narrowing**（本 stub 只做單層；巢狀關聯仍視為 optional）
- NestJS 介面型別（ambient 為 any → `implements CanActivate`、`: ExecutionContext` 等會報 TS2709，屬已知雜訊）

## 跑法
```bash
cd apps/api
# 1) 由 schema 生成 stub（每次 schema 變動後重跑）
node _verify/genstub.mjs prisma/schema.prisma _verify/stubs/@prisma/client/index.d.ts
# 2) 用獨立 tsc（npm pack typescript@5.5.4 解壓即可，TS 無相依）跑
node <tsc> -p tsconfig.verify.json
```
已知雜訊碼可過濾：`grep -vE 'TS2709|TS7006' | grep -vE '<deep-narrowing lines>'`。

## 重要
- `tsconfig.verify.json`、`_verify/` **不在** `tsconfig.build.json`（include 僅 `src/**/*`）→ **不影響**正式 `nest build` / jest。
- 生成的 `_verify/stubs/@prisma/client/index.d.ts` 為衍生物，schema 改動後請重生。
- 這**不能取代** CI 的 `build-test`（真實 generated client）；僅用於排除欄位層級錯誤。
