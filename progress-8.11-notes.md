# 8.11 前端 流程定義設計器改接 REST（#46）增量筆記

完成日期：2026-06-12（自動排程單輪完成）

## 本輪落地

- `apps/web/src/features/workflow-designer/api.ts`（新增）：REST 持久化層。
  - `AsyncWorkflowRepository`：`storage.ts` 同步 `WorkflowRepository` 的 Promise 版介面。
  - `createRestRepository(http)`：HTTP 可注入（`WorkflowHttp`），預設走 8.4 共用 client（lib/api）；
    list→`GET /workflows`、get→`GET /workflows/:id`（404→null）、
    save→`PATCH /workflows/:id` 全量儲存、404（新草稿）回退 `POST /workflows`、
    remove→`DELETE /workflows/:id` 回 `{deleted, deactivated}`（軟刪保護）。
  - `seedIfEmpty(repo)`：DB 全空時逐筆建立四大標準流程種子（沿用 localStorage 時代首用體驗）；
    403（無 workflow:manage）靜默略過、其他錯誤照拋。
- `WorkflowDesigner.tsx`：改非同步。LoadState（loading/ready/error+重試，沿用 AsyncStates）、
  請求序號防過時回應、busy 防連點、儲存/刪除失敗以行內 banner 呈現（保留編輯中內容）、
  軟刪（被案件引用改停用）顯示說明訊息；banner 文案改「儲存於系統資料庫」。
- `storage.ts`：標頭註解更新——localStorage 降級為備援/測試參考，未接生產 UI（程式不動，既有 designer.test.ts 不受影響）。
- `api.test.ts`（新增，12 案）：路徑編碼、isNotFound/isForbidden、PATCH→404 回退 POST、
  非 404 不回退、404→null、軟刪結果、seedIfEmpty 空/非空/403/500 行為。

## 驗證

- `vitest run`：17 檔 170 案全綠（sandbox 真跑）。
- `npm run build`（tsc -b strict + vite build）：綠。
- api 端無改動；prisma generate 於 sandbox 因 binaries.prisma.sh 403 無法跑，與本輪無關。

## 技術決策（同步記於 issue #46 comment）

1. 介面改 Promise 版而非硬塞同步介面：REST 本質非同步；UI 依 8.4 慣例補載入/錯誤狀態。
2. save 採 PATCH→404 回退 POST：與後端「客戶端 id 直接作為 DB id」（8.6 決策 5）對齊，
   免前端維護「已存在 id 集合」狀態。
3. 種子改由前端 seedIfEmpty 觸發（非後端 seed）：行為與 localStorage 時代一致、僅首次全空時發生；
   403 靜默確保一般使用者（僅 workflow:read）頁面可用。
4. localStorage 離線草稿降級與 updatedAt 樂觀鎖（issue 列為可選）：本輪未做，
   樂觀鎖需後端 PATCH 支援版本檢查，留待需要時開 follow-up。

## 對後續任務的影響

- #47（案件詳情）可沿用本輪 LoadState＋行內錯誤模式。
- 設計器儲存即寫 DB 並重建 StepDefinition，正式可「套用於新案件」；驗收的跨裝置持久化由 DB 保證。
- progress.md 中央表本輪未重推（檔案大、沿用 notes 分檔慣例）：8.2~8.10（#34~#45）實際已 done、
  8.11（#46）本輪 done、8.12~8.14（#47~#49）待辦、10.1（#38）待人類定案——以 GitHub issue label 為準。
