# 9.1 服務層整合測試（#36）— 進度 notes

> 沿用 progress-X.Y-notes.md 慣例。progress.md 主檔已達 78KB，經 API 整檔重推成本過高，
> 本輪狀態以本檔＋issue #36 comments 為準。**progress.md 的 issue 狀態表此刻過時**
> （仍標 8.1 進行中；實際 #33/#34/#35 已 done）。建議後續輪次將 progress.md 瘦身為
> 「技術堆疊＋狀態表＋指向各 notes 檔的索引」，否則每輪同步成本只會越來越高。

## 已落地（第 1 批，2026-06-08，commits `93cf006` / `1f7c87f`）
- `apps/api/jest.integration.config.js`：整測 jest 設定。`test/integration/*.int-spec.ts` 與單元測試（`*.spec.ts`，rootDir=src）分流，`pnpm test` 不撈整測；maxWorkers=1、testTimeout 30s。
- `apps/api/test/integration/setup.ts`：
  - `createTestPrisma()`：要求 DATABASE_URL；**非 localhost 連線 fail-fast**（除非 INTEGRATION_ALLOW_REMOTE_DB=1），避免誤清開發/正式庫。
  - `truncateAll()`：pg_tables 動態列表 → 單一 `TRUNCATE ... RESTART IDENTITY CASCADE`（保留 `_prisma_migrations`）。
- `apps/api/test/integration/forms.int-spec.ts`（7 案）：表單定義巢狀落地＋欄位排序、必填驗證失敗不落 submission、送出→核可「誰於何時」軌跡落 DB、退回後不可再核可＋NotFound、簽核類把關（SUBMITTED 不夠需 APPROVED）、非簽核類 SUBMITTED 即齊備＋跨步驟實例不可冒用、跨步驟引用（order 邊界）。
- `apps/api/package.json`：新增 `test:integration`。
- `.github/workflows/ci.yml`：新增 **integration-test job**（postgres:16 service、獨立 `wfms_test` DB、`prisma migrate deploy` → `test:integration`），與 migration-check 同模式。

## 技術決策
- 整測直接 `new FormsService(prisma)` 注入測試 PrismaClient，不經 Nest TestingModule：9.1 標的是 Service 的 DB 行為而非 DI 圖；REST 層 e2e 歸 9.2（#37）。
- 隔離策略用 beforeEach TRUNCATE＋runInBand，不用 transaction rollback：Service 內含 Promise.all 平行查詢，包交易會改變行為；TRUNCATE 對 ~20 表的 schema 夠快且最接近真實。

## sandbox 限制（本輪實證）
- 無 root → 無法 apt 裝 Postgres；`binaries.prisma.sh` 被網路 allowlist 擋 → `prisma generate`（含 `--no-engine`）無法完成，**本地無法實跑整測**。
- 已以 8.1 同款 stub-based tsc（strict，對 schema 真實欄位簽名）驗證 test+src 全綠。
- **實跑驗證以 CI integration-test job 為準。**

## 本機開發者實跑
```bash
docker compose up -d postgres
DATABASE_URL=postgresql://wfms:wfms@localhost:5432/wfms_test \
  pnpm --filter @wfms/api exec prisma migrate deploy
DATABASE_URL=postgresql://wfms:wfms@localhost:5432/wfms_test \
  pnpm --filter @wfms/api run test:integration
```
（建議獨立 `wfms_test` DB；整測會清空全部資料表。）

## 下一輪 TODO（接力指示）
1. **先看 CI**：檢查 main 最新 run 的 integration-test job 是否全綠；紅燈先修。
2. 依序補整測：workflow 推進把關（advance + 必填表單 gate 串 forms）、projects 掛載/進度回寫、kanban getBoard（AccessScope 可見範圍）、iso-trail getTrail/export（append-only 落地）。
3. 全部綠燈後再評估補 AccessScope 邊界案例，齊備才標 done。
