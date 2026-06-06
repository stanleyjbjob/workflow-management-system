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
| 2.3 | #14 表單與產出文件管理 | ✅ done | apps/api `forms/` 純引擎（驗證/簽核/必填把關/跨步驟引用）+ FormsService，25 項 jest 單元測試 |
| 2.4 | #15 作業範本附檔 | ✅ 本輪完成 | apps/api `templates/` 純引擎（驗證/版本計算/最新版/歷史/下載解析）+ TemplatesService，26 項 jest 單元測試 |
| 2.5~6.x | #16-#30 | 待辦 | 依 WBS 順序；下一個為 #16（2.5 附件與連結管理 SharePoint/OneDrive），相依 2.4 已滿足 |

## 2.4 交付物（本輪）
- `apps/api/src/templates/`：後端「作業範本附檔」模組（對應需求規格 §8.1、ISO §11.2 範本版本控管）。
  - `templates-engine.ts`：**純邏輯**（無 DB/Nest 相依，與 2.1/2.3 同風格）。
    - `validateTemplateInput` / `assertValidTemplateInput`：name 必填；fileUrl/linkUrl 須二擇一（不可皆空、不可同時提供）。
    - `nextVersion`：依既有 (stepId, name) 最大版本 +1（首版為 1），達成版本控管。
    - `planCreateTemplate`：驗證＋算版本，生成建立計畫（檔案型清空 linkUrl、連結型清空 fileUrl，去頭尾空白）。
    - `latestVersionByName` / `latestTemplates`：每個範本名稱取最新版（同版取 createdAt 較新），供承辦下載。
    - `templateHistory`：某名稱所有版本由新到舊（可追溯）；`distinctTemplateNames`：列出步驟內不重複範本名。
    - `resolveDownload`：解析某名稱最新可下載版本（檔案→fileUrl、連結→linkUrl，含來源可追溯）；找不到丟 `template_not_found`。
  - `templates.service.ts`：NestJS `TemplatesService`（依 Prisma 落實）：attachTemplate（自動累加版本）/getStepTemplates/getTemplateHistory/getTemplateNames/getDownloadTarget/getTemplateById。
  - `templates.module.ts`：`TemplatesModule`（提供並 export TemplatesService；PrismaModule 為全域）；已於 `app.module.ts` 註冊。
  - `templates-engine.spec.ts`：jest 單元測試（26 項，全綠）。

## 技術決策（本輪，供 review）
- **決策**：範本邏輯拆為純核心 + 服務（與 2.1/2.3 一致）。**理由**：版本計算/驗證可不依 DB 完整單元測試；服務只負責讀寫與錯誤轉換。
- **決策**：「同一份範本」以 (stepId, name) 識別，同名再上傳即累加版本，下載取最新、歷史保留全部。**理由**：符合 §8.1「範本具版本控管」與 ISO §11.2 可追溯；不需新增 schema 欄位（沿用既有 StepTemplate.version）。
- **決策**：來源強制 fileUrl/linkUrl 二擇一。**理由**：對應 §8.6 兩種附加方式（上傳檔案 / SharePoint/OneDrive 連結），避免一筆範本來源混淆。
- **決策**：本輪未新增 REST controller，亦未改動 schema（StepTemplate 已足夠）。**理由**：保守。串接點明確（設計器 2.2 已可掛範本、案件承辦於步驟下載），controller 屬後續 API 層任務。

## 開發者需知
- 本輪驗證：以 esbuild 轉譯 `templates-engine.ts` 與 `templates-engine.spec.ts`，於 Node 以 jest 相容 shim 跑測試 26/26 全綠；service/module/index 亦以 esbuild 轉譯與 bundle-check 確認 import/語法無誤（沙箱無完整 prisma client，CI 的 Ubuntu 會正常跑 `jest`）。
- **串接點（後續候選）**：(1) 為 templates 建 REST controller（上傳/列表/下載/版本歷史）；(2) apps/web 設計器將範本掛載與下載介面接上 API；(3) 案件承辦於步驟頁可下載最新範本。
- 範本實體儲存策略（檔案存系統 or 一律 SharePoint/OneDrive 連結）對應待釐清 §12-10，本輪以「URL 欄位」兼容兩種，待確認後再決定上傳儲存實作。

## 待釐清（沿用，需求 §12）
- §12-1 跨角色移交是否需主管核可、流程一律由特定角色發起 → 設計器已留「觸發角色＋條件」欄位，實際核可關卡待釐清。
- §12-5 行事曆遞延規則（順延下一工作日/整體後推）→ 設計器已留 deferStrategy 選項，實際曆法來源待 4.1 實作。
- §12-10 附件/範本實體儲存於系統或改以 SharePoint/OneDrive 連結為主、允許檔案類型與大小上限 → 影響 2.4/2.5 上傳實作，待主管確認。
