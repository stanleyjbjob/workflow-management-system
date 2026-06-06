# 專案開發進度（progress.md）

> 供自動化開發排程與後續人類複查掌握現況。每輪任務結束時更新。

## 技術堆疊（定案於 1.1）
- Monorepo：pnpm workspace（`apps/api` + `apps/web`）、Node 20、TypeScript。
- 後端：NestJS 10。資料庫：PostgreSQL 16（docker-compose）。
- ORM：**Prisma**（於 1.2 定案）。
- 認證：Entra ID OIDC（於 1.3 定案）。
- 授權：RBAC（於 1.4 定案）。
- 前端：**Vite + React 18 + TypeScript**（apps/web）；測試 **vitest**（於 2.2 引入）。
- 後端測試：**jest + ts-jest**（apps/api）。
- CI：`.github/workflows/ci.yml` — pnpm install（`--frozen-lockfile=false`）→ `pnpm -r build` → `pnpm -r test`。

## 各 issue 狀態
| WBS | Issue | 狀態 | 備註 |
|-----|-------|------|------|
| 1.1 | #8 專案初始化與技術選型 | ✅ done | 骨架、CI、docker-compose |
| 1.2 | #9 資料模型與 schema | ✅ done | Prisma schema(16 實體/31 FK)、init migration、seed、PrismaModule |
| 1.3 | #10 Microsoft 365 SSO | ✅ done | Entra OIDC Auth Code flow、群組對角色、停用拒絕、LoginAudit 稽核、單元測試 |
| 1.4 | #11 RBAC | ✅ done | 權限矩陣、@Roles/@Permissions Guard、AccessScopeService 可見範圍、單元測試 |
| 2.1 | #12 流程引擎：定義/狀態機/推進 | ✅ done | 純引擎狀態機 + WorkflowService、17 項單元測試 |
| 2.2 | #13 流程定義設計器 UI | ✅ done | apps/web 前端設計器；步驟/角色/表單/下一步/流程設定，localStorage 持久化，vitest 測試 |
| 2.3 | #14 表單與產出文件管理 | ✅ done | apps/api `forms/` 純引擎（驗證/簽核/必填把關/跨步驟引用）+ FormsService、25 項 jest 單元測試 |
| 2.4 | #15 作業範本附檔 | ✅ done | apps/api `templates/` 純引擎（驗證/版本計算/最新版/歷史/下載解析）+ TemplatesService、26 項 jest 單元測試 |
| 2.5 | #16 附件與連結管理（SharePoint/OneDrive）| ✅ done | apps/api `attachments/` 純引擎 + AttachmentsService、44 項 jest 單元測試 |
| 3.1 | #17 銷售流程 | 🔄 in-progress | apps/api `sales/` 純引擎（商機/拜訪會議紀錄 append-only/成案移交/失敗分類統計）+ SalesService、30 項測試全綠。**未完成**：見下方 handoff |
| 3.2~6.x | #18-#30 | 待辦 | 依 WBS 順序 |

## 3.1 交付物（本輪，#17，partial）
- `apps/api/src/sales/`：後端「銷售流程」模組（對應需求規格 §4）。
  - `sales-engine.ts`：**純邏輯**（無 DB/Nest 相依，與 2.1/2.3/2.4/2.5 同風格）。
    - 商機（§4.2~4.5）：`LeadSource` 五種來源（可多選）、`KNOWN_PRODUCTS`、`SaleMode` 買斷/訂閱；`validateOpportunity` / `normalizeOpportunity`（必填、去重來源、trim）。
    - 拜訪/會議紀錄（§4.5 步驟2、§4.6）：`materializeSalesRecord` 產生 **Object.freeze 不可變紀錄**（僅新增、不刪改 → 永久留存）；`sortRecordsChronological` / `filterRecordsByKind` 供調閱。
    - 產出/成案（§4.5 步驟3~5a、§4.6）：`SalesDoc`（報價單/客製需求）、`latestDoc` / `finalQuote`、`planWin` → 帶出定版報價單 + 最新客製需求的 `HandoffPayload`、Case 轉 COMPLETED；無定版報價單則拋 `no_final_quote`。
    - 失敗（§4.5 步驟5b、§4.6）：`planLoss` 轉 FAILED + 結構化（category+reason）、`summarizeFailureReasons` 依分類統計。
  - `sales-engine.spec.ts`：jest 單元測試 **30 項**（sandbox esbuild + jest-shim 驗證全綠）。
  - `sales.service.ts`：`SalesService`（Prisma）：createOpportunity（建 SALES Case）/ markWon（planWin + Case→COMPLETED）/ markLost（Case→FAILED，failureReason 編碼 `category|reason`）/ failureStatistics。
  - `sales.module.ts` / `index.ts`：`SalesModule`（已於 `app.module.ts` 註冊）。

## 技術決策（本輪，供 review）
- **決策**：沿用 2.x「純引擎 + Service」風格，引擎不依賴 DB 可被純函式測試。**理由**：一致、可測。
- **決策**：拜訪/會議紀錄以 `Object.freeze` 不可變物件表達「append-only / 永久留存」；引擎不提供刪改 API。**理由**：對應 §4.6「可重複新增並永久留存」。
- **決策**：成案移交以 `HandoffPayload.carriedDocRefIds` 帶出產出引用，不複製檔案。**理由**：對應 §4.6「報價單與客製需求文件自動帶往後續」；實際下游 ONBOARDING 案件建立／連結尚未實作（見 handoff）。
- **決策**：失敗分類 `category` 暫以**可擴充字串**承載、`Case.failureReason` 以 `category|reason` 編碼。**理由**：§12-2「失敗原因分類項目」屬待釐清事項，不臆測固定 Enum；待主管確認後再收斂為欄位/Enum 並補 migration。

## 本輪未完成 / Handoff（下一輪或人類接手）
1. **拜訪/會議紀錄持久化落地**：目前引擎提供不可變紀錄邏輯，實際儲存擬沿用 forms（FormSubmission）/attachments（Attachment）既有持久化；需在 SalesService 補上「新增紀錄」對應方法或確認以表單模組承載。
2. **成案下游移交**：markWon 目前僅回傳 HandoffPayload 並轉 Case 狀態；尚未自動建立/連結後續 ONBOARDING 案件（§3 流程銜接）。待與 5.x 導入流程一併設計。
3. **失敗分類 schema 收斂**：待 §12-2 確認失敗原因分類清單後，將 category 由字串收斂為 Enum/獨立欄位或資料表，並調整 failureStatistics 查詢。
4. **REST controller / 前端 UI**：尚未提供（與 2.3/2.4/2.5 同，屬後續 API 層任務）。

## 待釐清（沿用，需求 §12）
- §12-1 跨角色移交是否需主管核可、流程一律由特定角色發起 → 設計器已留「觸發角色＋條件」欄位，實際核可關卡待釐清。
- §12-2 失敗原因分類項目（供改善分析報表）→ 影響 3.1 失敗分類 Enum 收斂，本輪以可擴充字串承載。
- §12-5 行事曆遞延規則（順延下一工作日/整體後推）→ 設計器已留 deferStrategy 選項，實際曆法來源待 4.1 實作。
- §12-10 附件/範本實體儲存於系統或改以 SharePoint/OneDrive 連結為主、允許檔案類型與大小上限 → 影響 2.4/2.5 上傳實作，待主管確認。
