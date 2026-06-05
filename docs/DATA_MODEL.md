# 資料模型（v1, issue 1.2）

本文件描述核心資料模型，實作於 `apps/api/prisma/schema.prisma`（Prisma + PostgreSQL）。
對應「需求規格.md」與「專案管理模組規格.md」。

## 技術選型

ORM 採用 **Prisma**：以宣告式 schema 管理資料模型、型別安全的 client、以及內建 migration 與 seed 機制，
與現有 NestJS + PostgreSQL 16 地基相契。連線字串統一由 `DATABASE_URL` 提供（地端買斷 / 雲端訂閱租戶皆適用）。

## 實體一覽

### 使用者與權限（RBAC）
- **User**：系統使用者；`entraOid` 對應 Microsoft Entra ID（SSO，issue 1.3 使用）；`isLocalAccount` 保留例外帳號。
- **Role**：角色（MANAGER / SALES / CONSULTANT / ENG_LEAD / ENGINEER / ASSISTANT）；`entraGroupId` 可對應 Entra 群組。
- **UserRole**：User ↔ Role 多對多。

### 流程定義
- **WorkflowDefinition**：可自定義流程（四大類型 FlowType），含版本。
- **StepDefinition**：步驟（順序、負責角色、預設下一步 `nextStepId` 自關聯、是否可選）。
- **StepTemplate**：步驟附加的作業範本檔（檔案或連結）。
- **FormDefinition / FormField**：可自定義表單與欄位（含簽核類 `isSignable`、欄位型別 FieldType）。
- **StepForm**：StepDefinition ↔ FormDefinition 多對多（某步驟應填表單）。

### 案件（流程實例）
- **Case**：一個流程實例（狀態、銷售模式、目前步驟、失敗原因）。
- **StepInstance**：案件下的步驟實例（狀態、承辦人、到期日）。
- **FormSubmission**：表單填寫（`data` JSON、簽核狀態），為 ISO 文件化軌跡來源。
- **Attachment**：附件 / 連結（FILE 或 LINK；LINK 優先支援 SharePoint / OneDrive），可掛於 Case / StepInstance / FormSubmission。

### 專案管理
- **Project**：跨流程管理單位（名稱、客戶、負責人、計畫起迄、狀態）。
- **ProjectFlow**：專案下的流程掛載（`caseId` 可為空；progress 0-100）。
- **Exclusion**：專案行事曆排除日（起迄、原因、來源）。

## 使用方式

```bash
# 1. 啟動 PostgreSQL（docker-compose 已含 db 服務）
docker compose up -d db

# 2. 套用 migration（首次建表）
pnpm --filter @wfms/api prisma:deploy   # 生產：套用現有 migration
# 或開發時：pnpm --filter @wfms/api prisma:migrate

# 3. 載入種子資料
pnpm --filter @wfms/api db:seed
```

> 驗證狀態：schema 已以 Prisma 官方 schema 驗證器確認模型與 31 條外鍵關聯皆正確；
> init migration SQL 已以 PostgreSQL 語法剖析器（libpg-query）驗證無語法錯誤；
> 種子腳本鐘輯以 mock client dry-run 驗證可執行。實際對 DB 的 migrate/seed 需於含 Postgres 的環境（CI/本機）執行。
