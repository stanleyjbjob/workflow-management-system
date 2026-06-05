# 開發規範

## 環境需求

- Node.js 20（見 `.nvmrc`）
- pnpm 9（`corepack enable` 或 `npm i -g pnpm`）

## 快速開始

```bash
pnpm install
pnpm -r build       # 建置全部
pnpm -r test        # 測試全部
pnpm --filter @wfms/api dev    # 啟動後端（http://localhost:3000/health）
pnpm --filter @wfms/web dev    # 啟動前端（http://localhost:5173）
# 或一鍵以容器啟動：
docker compose up --build
```

## 分支策略

- 主幹開發（trunk-based）：`main` 為唯一長期分支，必須保持可建置、可部署。
- 功能以短命分支開發：`feat/<簡述>`、`fix/<簡述>`、`chore/<簡述>`。
- 透過 Pull Request 合入 `main`，CI 綠燈後方可合併（不直接 push 破壞性變更至 main）。

## Commit 訊息

採 Conventional Commits：`feat:`、`fix:`、`docs:`、`chore:`、`test:`、`refactor:` …

## 程式碼風格

- 由 Prettier 統一格式（`.prettierrc.json`）。
- 共用 TS 編譯設定於 `tsconfig.base.json`。
