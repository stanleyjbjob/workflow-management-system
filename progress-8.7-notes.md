# progress 8.7 notes（issue #42：後端 案件統一查詢/詳情/推進 REST /cases）

完成日期：2026-06-11（單輪完成）

## 落地內容
- 新增 `apps/api/src/cases/`：CasesModule / CasesController / CasesService（+ spec、index）。
- `app.module.ts` 掛入 CasesModule。
- 路由：
  - `GET /cases?flowType=&status=&assigneeId=`（case:read）：摘要清單，`AccessScopeService.caseWhere` 收斂可見範圍，過濾條件 AND 疊加；非法 enum 回 400 `invalid_flow_type` / `invalid_status`。
  - `GET /cases/:id/detail`（case:read）：單次彙整案件基本資料＋步驟（順序/名稱/說明/負責角色名/負責人/到期日/狀態/note）＋各步驟表單狀態＋附件清單；不可見 403 `case_not_visible`、不存在 404 `case_not_found`。
  - `POST /cases/:id/advance`、`POST /cases/:id/return`（case:advance）：包 WorkflowService.advanceCase / returnCase，先 assertCanViewCase；return 必帶 `targetStepDefinitionId` 與非空 `reason`（400 `target_step_required` / `return_reason_required`）。

## 關鍵決策
1. 表單狀態彙整：同步驟實例×同表單多筆 submission 取「最佳」（APPROVED > SUBMITTED > REJECTED > DRAFT，同階取最新建立）；無紀錄 = `MISSING`。`satisfied` 與 forms-engine.unmetRequiredForms 同義（必填且可簽核需 APPROVED）。
2. 附件以 `OR [caseId, stepInstance.caseId, formSubmission.caseId]` 一次撈齊，不假設步驟/表單層附件有冗餘 caseId。
3. detail 回傳為「API 正規化 DTO」（ISO 字串日期、UserRef 內嵌），不直接套前端 CaseRecord 顯示型別（顯示標籤/pill 屬前端 #47 對映層職責）。
4. 推進/退回僅做可見性斷言＋參數驗證，不重複引擎業務規則；四大流程專屬動作（成案/失敗結案等）仍走各自 controller。

## 驗證
- sandbox 真跑（prisma 假引擎法 generate）：`nest build` ✅、`jest` 33 suites / 604 tests 全綠（含新增 cases spec 8 案）。
- web 未動，未跑。

## 後續
- #44–#49 前端串接可用：看板卡點開 → `GET /cases/:id/detail`（#47）。
- 案件清單分頁/排序參數（page/pageSize/orderBy）目前未做，前端需要時再加。
