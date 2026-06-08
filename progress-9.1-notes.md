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

## 已落地（第 2 批，2026-06-08）
- `apps/api/test/integration/workflow.int-spec.ts`（6 案）：WorkflowService 狀態機 DB 落地與回寫。
  - 建立案件物化全部步驟（第一步 IN_PROGRESS + startedAt + 承辦人；其餘 PENDING）、case.currentStepInstanceId 落地。
  - advanceCase：完成目前步驟（COMPLETED + completedAt + note）、下一步轉 IN_PROGRESS + startedAt + 帶出承辦人、case 指標回寫。
  - 推進到最後一步：案件 COMPLETED、currentStepInstanceId 清空、所有步驟 COMPLETED。
  - 守門：完成後（no_current_step）再推進丟 BadRequest；找不到流程/案件丟 NotFound。
  - 退回：目前步驟 RETURNED 並保留退回原因、重啟較早步驟（completedAt 清空、case 指標回寫；支援循環）。
- 沿用第 1 批 setup.ts（createTestPrisma fail-fast + truncateAll）；直接 `new WorkflowService(prisma)` 注入，理由同 forms（9.1 標的是 Service 的 DB 行為，非 Nest DI 圖）。

## 技術決策（第 2 批）
- workflow「必填表單 gate」的把關邏輯在 `FormsService.getStepCompletionGate`（第 1 批已覆蓋），`WorkflowService.advanceCase` 本身不串 forms gate（推進計算走純引擎 planAdvance）。故本批 workflow 整測聚焦狀態機落地/回寫，不重複 forms gate；REST 層把關串接歸 9.2（#37）。
- 退回（returnCase）以 RETURNED 狀態 + note 保留原因落地，符合 §8.4「退回原因須留存」；驗證 completedAt 於重啟步驟被清空（避免循環後殘留舊完成時間）。

## 本輪驗證方式（sandbox 限制不變）
- `binaries.prisma.sh` 仍被 allowlist 擋 → 無法 `prisma generate`、本地無法實跑整測。
- 以 stub-based tsc 5.5.4（strict + noImplicitAny）驗證：手寫 `@prisma/client` / `@nestjs/common` stub（delegate 泛型對齊 schema 真實欄位），對 workflow.int-spec + setup + workflow.service + workflow-engine + prisma.service 一起 typecheck → **exit 0 全綠**。harness 置於 `apps/api/_verify/`（未提交）。
- **CI 紅燈待查**：本輪嘗試讀 CI run #120（main, sha f751081）job 級結果，但可用的 GitHub API 在此環境對 actions/runs/<id>/jobs 與 commits/<sha>/check-runs 回空 body（小 JSON 取不到），無法判定 integration-test job 是否綠。觀察：CI 整體自 #116 起連續紅，含純前端 commit（#116/#117 8.3 web），研判紅燈來源較可能是 build-test job 的 `pnpm -r test`（含 web 套件），而非 integration-test。**下一輪務必確認 integration-test job 實際狀態**（人工看 Actions 頁或在有 token 的環境查 jobs API）。

## 已落地（第 3 批，2026-06-08）
- `apps/api/test/integration/kanban.int-spec.ts`（4 案）：KanbanService.getBoard DB 行為。
  - 主管綜覽看到全部案件；COMPLETED 落 DONE 欄；responsibleRoleCode 由 stepDefinition.responsibleRole 落地；KPI（pending/upcoming/overdue/deferred）統計正確。
  - 「即將到期」欄同時收納即將到期與逾期；週六到期之卡片由 CalendarService（DB Holiday 驅動）標示 deferred + deferredDays>0；無到期日落 TODO。
  - 非主管（SALES）以 AccessScope.caseWhere 收斂：看得到 SALES 流程型別與自己經手案件，看不到他人 ONBOARDING 案件。
  - filter：在可見範圍上再依 flowType 過濾。
  - 基準時間固定 2026-06-10（週三，無內建假日），避免 new Date() 非決定性；到期日刻意選工作日/週末以對齊 upcoming/overdue/deferred 分類。
- `apps/api/test/integration/iso-trail.int-spec.ts`（4 案）：IsoTrailService.getTrail / export DB 行為。
  - 主管綜覽跨來源全彙整（表單×2 + 附件×1 + 登入×2 + 專案進度/排除×2 = 7）；簽核缺口統計（signableCount/signedCount/pendingSignatureCount）。
  - 非主管（SALES）：案件相關（表單/附件）以 caseWhere 收斂、登入僅本人、不含專案層紀錄（共 3 筆）。
  - exportAudit/exportCsv：summary.total、pendingSignatureIds、扁平 CSV 列數（表頭 + 7 列）與內容。
  - retentionPolicy 注入：retentionUntil 落地；以遠未來基準計入 expiredRetentionCount。

## 技術決策（第 3 批）
- kanban 整測同時實例化 `AccessScopeService` 與 `CalendarService(prisma)`，直接 `new KanbanService(prisma, accessScope, calendar)`：標的是「AccessScope 可見範圍收斂 + Calendar 假日遞延」兩條 DB 相依路徑的真實組合，故注入真服務而非 mock。
- iso-trail 非主管可見範圍：依 service 既有設計，登入紀錄僅本人、專案層紀錄（ProjectFlow/Exclusion）僅主管可見 → 整測據此斷言（非主管 0 筆專案紀錄），固化現行收斂行為。
- 簽核 gate 以 SubmissionStatus 驅動：APPROVED→signedOff、SUBMITTED 之 signable 表單入 pendingSignature；以「委任授權書（DELEGATION_AUTH，requiresSignature）」作為 signable 樣本。

## 本輪驗證方式（第 3 批；sandbox 限制不變）
- 仍無法 `prisma generate`、本地無法實跑整測。
- stub-based tsc 5.5.4（strict + noImplicitAny + experimentalDecorators）：harness `apps/api/_verify/`（未提交），paths 將 `@prisma/client`（enum 對齊 schema：RoleCode/FlowType/StepInstanceStatus/SubmissionStatus/AttachmentType/HolidaySource/HolidayType/AuthEventType + 泛型 Delegate + Prisma 命名空間）與 `@nestjs/common`（Injectable/exceptions/Logger 等）指到手寫 stub；jest globals 與 node 環境（crypto/Buffer/URLSearchParams/fetch）以 ambient d.ts 宣告。
- 對 kanban.int-spec + iso-trail.int-spec + setup.ts 及其完整相依樹（kanban/iso-trail/calendar/access-scope service+engine、prisma.service、auth.service 鏈）一起 typecheck → **exit 0 全綠**。
- 注意：Delegate 回傳 Promise<any>，故 prisma `data:{}` 內欄位名 typo 不會被 tsc 抓到；本批已逐欄對照 `prisma/schema.prisma`（User.displayName、Case.code/flowType/assigneeId/createdById、FormSubmission.formDefinitionId/submittedById/approvedById、Attachment.type/uploadedById、LoginAudit.userId/eventType、Project/ProjectFlow/Exclusion 欄位）確認無誤。下一輪實跑 CI 仍為最終把關。

## 下一輪 TODO（接力指示）
1. **先確認 CI**：人工或以有權限的 API 查 main 最新 run 的 **integration-test job** 是否綠；若紅先修。整體 CI 另有 build-test（含 web）可能獨立紅，與 9.1 標的不同，勿混淆。
2. 剩餘整測（最後一塊）：**projects 掛載/進度回寫**（ProjectFlow 掛 case、進度/延遲計算落地、AccessScope.projectWhere 收斂）。forms / workflow / kanban / iso-trail 已覆蓋。
3. projects 補齊且全部綠燈後，評估是否再補 AccessScope 邊界案例；齊備才標 done。

## 驗收要點對應現況（issue #36）
- 「整合測試可在 CI 啟動 DB 並通過」：CI job 已建（第 1 批），**job 級綠燈待人工確認**。
- 「覆蓋主要 Service 路徑與權限收斂」：forms / workflow / kanban / iso-trail 已覆蓋（含 AccessScope 收斂）；**僅剩 projects 未覆蓋**。
