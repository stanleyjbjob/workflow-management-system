# 6.2 ISO 27001 文件化軌跡 — 本輪交付補充（#30）

> 本檔為 6.2 本輪交付的補充說明，避免一次性改寫 53KB 的 progress.md 造成風險。
> 後續人類複查 / 下一輪可將重點併入 progress.md 主表（6.2 列狀態）。
> 對應需求規格 §11（ISO 27001 文件化需求對應框架）。

## 狀態
🔄 **未完成（保留 in-progress）**。技術骨架（版本控管 / 簽核軌跡 / 留存期限 / 可追溯性 / 查閱 / 匯出）已落地並測試通過；
但 §11.3 規格層級待釐清（現行 ISO 文件清單與 Annex A 對應、留存期限、簽核層級）尚待主管定案，
依排程開發原則「規格不確定不臆測業務規則」，故本輪不標 done，等人類回覆後再收尾。

## 交付物
- `apps/api/src/iso-trail/iso-trail-engine.ts`：**純引擎**（無 DB/Nest/Prisma 相依，日界 UTC，沿用 2.x~6.1 風格）。
  - 統一「可追溯紀錄 TraceabilityRecord」：收斂表單填寫 / 附件 / 登入 / 專案進度 / 排除日五類來源。
  - 版本控管：`version`（表單取 FormDefinition.version、附件取 Attachment.version）。
  - 簽核軌跡 `buildSigningTrail`：CREATED→SUBMITTED→APPROVED/REJECTED 事件序列（誰/何時），`signStatusOf`/`signedOff`。
  - §11.2 對應：`DEFAULT_ISO_ASPECT_MAP`（文件種類→ISO 面向/是否需簽核，含 A.5）、`classifyFormByCode`（代碼/名稱關鍵字啟發式，可整批覆寫）。
  - 留存期限 `computeRetentionUntil`/`isRetentionExpired`：依「可注入政策」推導；**無政策一律 null（不臆測）**，附 `SAMPLE_RETENTION_POLICY` 範例（非預設）。
  - 查閱 `filterTrail`（recordType/documentKind/日期/case/project/actor/簽核狀態）、缺口 `pendingSignatures`（要求簽核未完成）、彙總 `summarizeTrail`。
  - 匯出 `toAuditExportRows`/`toCsv`（含 CSV 轉義）/`buildAuditExport`（彙總+缺口+扁平列）。
- `apps/api/src/iso-trail/iso-trail-engine.spec.ts`：**37 案**單元測試（sandbox 自製 jest-harness 全綠 PASS=37；引擎另過 tsc --strict + --noUnusedLocals/Parameters）。
- `apps/api/src/iso-trail/iso-trail.service.ts`：`IsoTrailService`（Prisma + AccessScopeService）。彙整 FormSubmission/Attachment/LoginAudit/ProjectFlow/Exclusion；案件相關以 `caseWhere` 收斂、登入/專案紀錄主管可查全部、非主管僅自己的登入紀錄。`getTrail/getSummary/exportAudit/exportCsv`。
- `apps/api/src/iso-trail/iso-trail.controller.ts`：`GET /iso-trail`、`/summary`、`/export`、`/export.csv`（SessionAuthGuard + PermissionsGuard `case:read`）。
- `iso-trail.module.ts` / `index.ts`；`app.module.ts` 註冊 `IsoTrailModule`。
- service/controller/module 以 stub（PrismaService/@nestjs/common/@prisma/client/auth/rbac）通過 tsc --strict + noUnused。

## 驗收對照（issue #30）
- 「關鍵表單具簽核與版本軌跡」→ ✅ formSubmissionToRecord 帶 version + buildSigningTrail（簽核類 requiresSignature=true、APPROVED→signedOff）。
- 「可匯出/查閱稽核紀錄」→ ✅ getTrail/filterTrail + exportAudit/exportCsv（JSON + CSV）。
- 「登入紀錄、專案進度/排除日納入軌跡」→ ✅ loginToRecord（A.5）/ projectRecordToRecord（PROGRESS/EXCLUSION）。
- 「以流程強制填寫/簽核取代人工 ISO 文件」→ 部分：pendingSignatures 提供缺口清單；強制把關沿用 2.3 FormsService.getStepCompletionGate（簽核類需 APPROVED 才齊備）。

## 技術決策（供 review）
- **決策（6.2）**：iso-trail 引擎與 Prisma 解耦，以結構型別接收輸入，由 IsoTrailService 負責 map。理由：沿用 kanban/delay/reminder 解耦風格，引擎可純函式測試。
- **決策（6.2）**：留存期限以「可注入政策」實作，未提供時 retentionUntil=null。理由：§11.3 留存期限未定案，不臆測；主管定案後注入 `retentionPolicy` 即生效，引擎不需改。
- **決策（6.2）**：表單→ISO 文件種類採關鍵字啟發式對照（DEFAULT_FORM_KIND_PATTERNS）+ 可由呼叫端整批覆寫，亦可由 FormSubmissionTraceInput.documentKind 直接指定。理由：現行 ISO 文件清單未提供（§11.3），先給合理可用對照並保留覆寫。
- **決策（6.2）**：可見範圍——案件相關（表單/附件）重用 1.4 AccessScopeService.caseWhere；登入/專案層紀錄屬稽核資料，主管可查全部、非主管僅自己的登入紀錄。理由：稽核軌跡通常為主管/稽核角色範圍，兼顧最小揭露。

## 待釐清（§11.3，已於 issue #30 留 comment 詢問，未完成主因）
1. 現行 ISO 27001 文件清單與其對應 Annex A 控制項（完成 §11.2 完整對應）。
2. 各類文件留存期限（年數）——目前 retentionUntil 預設 null，待定案注入政策。
3. 簽核層級（單關/多關、哪些表單強制簽核）——目前以 isSignable + §11.2 requiresSignature 標示，未實作多關簽核鏈。

## 下一步（收尾，待人類/下一輪）
- 主管提供 §11.3 三項後：注入正式 `IsoRetentionPolicy`、校正 form code→documentKind 對照、（如需）擴充多關簽核鏈。
- 前端「文件化軌跡/稽核查閱」頁（沿用 task-kanban/project-gantt 風格，接 /iso-trail REST）。
- CI 全流程 `pnpm -r build`（需 generated Prisma client）於真實 monorepo 驗證；vitest/jest 於真實環境跑綠。
