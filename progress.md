# 專案開發進度（progress.md）

> 供自動化開發排程與後續人類複查掌握現況。每輯任務結束時更新。

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
| 2.5 | #16 附件與連結管理（SharePoint/OneDrive）| ✅ 本輯完成 | apps/api `attachments/` 純引擎（驗證/目標解析/版本/連結供應商/權限模型/下載解析）+ AttachmentsService、44 項 jest 單元測試 |
| 3.1~6.x | #17-#30 | 待辦 | 依 WBS 順序；下一個為 #17（3.1 銷售流程），相依階段2 已全數完成 |

## 2.5 交付物（本輯）
- `apps/api/src/attachments/`：後端「附件與連結管理」模組（對應需求規格 §8.6；ISO 27001 文件化軌跡）。
  - `attachments-engine.ts`：**純邏輯**（無 DB/Nest 相依，與 2.1/2.3/2.4 同風格）。
    - `resolveTarget` / `sameTarget`：附件可綁定案件/步驟實例/表單提交三者「剛好一個」目標（未提供/多個皆拋錯）。
    - `validateAttachmentInput` / `assertValidAttachmentInput`：name 必填；fileUrl/linkUrl 須二擇一；sizeBytes 須非負整數；目標合法。
    - `linkProvider` / `isM365Link`：依 host 辨識 SharePoint / OneDrive（含 *-my.sharepoint.com、1drv.ms、onedrive.live.com）。
    - `permissionModelOf`：檔案→SYSTEM、M365 連結→M365_INHERITED（沿用雲端權限）、其他連結→EXTERNAL。
    - `nextVersion` / `planCreateAttachment`：以（目標+name）識別同一附件，同名再上傳自動累加版本；檔案型清 linkUrl、連結型清 fileUrl。
    - `latestAttachments` / `attachmentHistory` / `resolveDownload` / `distinctAttachmentNames`：最新可下載清單、版本歷史（可追溯）、下載解析（含上傳者/時間/權限模型）。
  - `attachments.service.ts`：NestJS `AttachmentsService`（依 Prisma `Attachment` 落實）：addAttachment（自動累加版本）/listAttachments/getAttachmentHistory/getAttachmentNames/getDownloadTarget/getAttachmentById。
  - `attachments.module.ts`：`AttachmentsModule`（提供並 export AttachmentsService）；已於 `app.module.ts` 註冊。
  - `attachments-engine.spec.ts`：jest 單元測試（44 項，全綠）。

## 技術決策（本輯，供 review）
- **決策**：沒有新增 schema—直接沿用 1.2 已存在的 `Attachment` 實體（已含 type/name/fileUrl/linkUrl/mimeType/sizeBytes/version/uploadedById 與 case/stepInstance/formSubmission 三個綁定欄位）。**理由**：schema 已足夠，保守，免 migration。
- **決策**：邏輯拆為純核心 + 服務（與 2.1/2.3/2.4 一致）。**理由**：驗證/版本/權限判定可不依 DB 完整單元測試。
- **決策**：SharePoint/OneDrive 連結以 `permissionModel=M365_INHERITED` 標記，不複製檔案。**理由**：對應驗收「連結可沿用既有雲端權限」—存取交由 M365 ACL，系統只存引用。
- **決策**：目標「剛好一個」而非多選。**理由**：一筆附件邏輯上只歸屬單一載體（案/步驟/表單），避免歸屬混淆；cross-target 查詢由上層分別呼叫。
- **決策**：本輯未新增 REST controller。**理由**：保守，與 2.3/2.4 一致；controller / 檔案實體上傳儲存屬後續 API 層任務。

## 開發者需知
- 本輯驗證：以 esbuild 轉譯 `attachments-engine.ts` 與 spec，於 Node 以 jest 相容 shim 跡測試 44/44 全綠；service/module/index 亦以 esbuild 轉譯確認 import/語法無誤（沙箱無完整 prisma client，CI 的 Ubuntu 會正常跡 `jest`）。
- **串接點（後續候選）**：(1) 為 attachments 建 REST controller（上傳/列表/下載/版本歷史）；(2) 檔案實體儲存策略待 §12-10 釐清後實作（本輯以 fileUrl/linkUrl 欄位兼容兩種）；(3) apps/web 提供附件上傳/下載 UI 並接上 API。

## 待釐清（沿用，需求 §12）
- §12-1 跨角色移交是否需主管核可、流程一律由特定角色發起 → 設計器已留「觸發角色＋條件」欄位，實際核可關卡待釐清。
- §12-5 行事曆遞延規則（順延下一工作日/整體後推）→ 設計器已留 deferStrategy 選項，實際曆法來源待 4.1 實作。
- §12-10 附件/範本實體儲存於系統或改以 SharePoint/OneDrive 連結為主、允許檔案類型與大小上限 → 影響 2.4/2.5 上傳實作，待主管確認（本輯已以 permissionModel 與 fileUrl/linkUrl 兼容兩種來源）。
