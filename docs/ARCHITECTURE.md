# 架構與技術選型（ADR-0001）

> 對應 issue #8（WBS 1.1 專案初始化與技術選型）。本文記錄第一輪確立的技術決策與理由，供後續 review 調整。

## 1. 部署需求前提

需求規格要求同時支援兩種交付模式：

- **買斷制（地端）**：客戶採購主機後於客戶端部署。
- **訂閱制（雲端租戶）**：以開立租戶方式提供。

因此架構以「可容器化、可自架、單一程式碼庫支援多租戶部署」為核心原則。

## 2. 技術選型

| 層 | 選型 | 理由 |
|----|------|------|
| Monorepo | pnpm workspaces | 前後端共用型別與設定，單一 repo 管理；pnpm 安裝快、磁碟省。 |
| 後端框架 | NestJS (TypeScript) | 模組化 + DI 架構契合「流程引擎、RBAC、表單定義」等領域邊界；生態成熟，OIDC/Passport、排程、驗證皆有官方套件。 |
| 資料庫 | PostgreSQL | 關聯式確保流程/案件/簽核的一致性；JSONB 欄位可彈性儲存「使用者自訂流程與表單定義」，兼顧結構化與彈性。 |
| ORM | Prisma（規劃於 issue #9 1.2 導入） | 型別安全、migration 友善。 |
| 前端 | React + Vite + TypeScript | 生態成熟、與原型一致；Vite 開發體驗佳，建置為靜態檔利於地端 / 雲端部署。 |
| 認證 | Microsoft Entra ID（OIDC / OAuth 2.0，issue #10 1.3） | 公司主要使用 Microsoft 365，SSO 免維護額外帳密。 |
| 容器化 | Docker + docker-compose | 一套 compose 同時起 db / api / web，地端與雲端皆可用。 |
| CI | GitHub Actions | 與 repo 原生整合；本輪先跑 build + test。 |

> 備註：後端亦評估過 Python FastAPI。選 NestJS 是因為前後端同為 TypeScript 可共用型別、且其模組化結構更適合本系統「可自訂流程 + RBAC」的領域複雜度。此決策可於 review 時推翻。

## 3. Repo 結構

```
.
├─ apps/
│  ├─ api/        # NestJS 後端（含 /health 空殼端點）
│  └─ web/        # Vite + React 前端空殼
├─ docs/          # 需求規格、專案管理模組規格、本架構文件
├─ prototype/     # 既有可點擊原型
├─ docker-compose.yml
├─ tsconfig.base.json
└─ .github/workflows/ci.yml
```

## 4. 本輪交付（最小可運行骨架）

- `apps/api`：NestJS + `GET /health` 健康檢查端點 + 單元測試。
- `apps/web`：React 空殼，啟動時呼叫 `/health` 顯示 API 狀態。
- `docker-compose.yml`：postgres + api + web。
- CI：`pnpm -r build` + `pnpm -r test`。
- 程式碼規範：EditorConfig + Prettier；分支策略見 `CONTRIBUTING.md`。

## 5. 後續（由其他 issue 承接）

- #9 (1.2) 資料模型與 Prisma schema、migration。
- #10 (1.3) Entra ID SSO。
- #11 (1.4) RBAC。
