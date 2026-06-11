# progress 8.8 notes（issue #43：後端 表單/附件/範本 REST 補齊）

完成日期：2026-06-11（單輪完成，自動排程）

## 落地內容
- `apps/api/src/common/case-access.{service,module}.ts`（新增）：CaseAccessService — 由
  caseId / stepInstanceId / formSubmissionId（三擇一，多指定或未指定 → 400 `invalid_target`）
  回溯所屬案件，委派 AccessScopeService.assertCanViewCase 斷言（403 `case_not_visible`，
  不存在 404 `case_not_found` / `step_instance_not_found` / `submission_not_found`）。
- `forms/forms.controller.ts`（新增，3 個 controller 類別）：
  - `POST /forms/submissions`（form:fill）：填寫，submittedById＝登入者。
  - `POST /forms/submissions/:id/approve|reject`（form:approve）：簽核，簽核人＝登入者。
  - `GET /cases/:caseId/submissions`（form:read）：案件全部提交（CaseSubmissionsController 同掛 cases 前綴，與 CasesController 路徑不重疊）。
  - `GET /steps/:stepId/forms`（form:read）：步驟掛載表單含欄位定義，供 UI 渲染填寫表單。
- `attachments/attachments.controller.ts`（新增）：`GET/POST /attachments`、`GET /attachments/download`、
  `GET /attachments/history`（attachment:read / attachment:upload）；目標三擇一 query/body 指定；
  uploadedById＝登入者；下載回「解析結果」（SharePoint/OneDrive 沿用 M365 雲端權限，不代理串流）。
- `templates/templates.controller.ts`（新增）：`GET /steps/:stepId/templates`、`.../download?name=`、
  `.../history?name=`（attachment:read）。只開讀取端點（見決策 4）。
- 三個 module 掛 controllers 並 imports AuthModule + RbacModule（forms/attachments 另 imports CaseAccessModule）；index.ts 補 export。app.module 既已註冊三模組，無需改動。

## 關鍵決策
1. **通用層 vs 流程層分工**：流程層 `POST .../forms/:formCode` 負責流程語意（formCode 對應步驟、推進把關）；本通用層以 formDefinitionId / submissionId 直接操作，供案件詳情頁等跨流程 UI 使用，互補不重複（驗收要點要求的分工說明）。
2. **案件可見性抽共用 CaseAccessService**：forms / attachments 皆「比照所屬案件權限」，由任一目標回溯 caseId 再走 1.4 AccessScope；避免三處重複、與 CasesService 既有做法一致。
3. **權限對應**：填寫 form:fill、簽核 form:approve、查詢 form:read；附件 attachment:read/upload；範本用 attachment:read（範本本質為附檔、所有業務角色皆具讀權）。沿用 1.4 既有矩陣，未新增權限。
4. **範本只開讀取**：範本上傳／管理屬流程設計者職責、UI 尚無對應互動，刻意不臆測管理介面需求；待 8.11 流程設計器需要時再補寫入端點。
5. **表單定義 CRUD（createForm / attachFormToStep）未開 REST**：屬流程設計器（8.11/#46）設計領域，非案件詳情頁互動所需（issue 建議最小集也未列）。

## 驗證（sandbox 真跑，「假引擎法」prisma generate）
- `tsc -p tsconfig.build.json --noEmit`：0 error。
- `jest` 全套：**37 suites / 630 tests 全綠**（含新增 4 suites / 26 案：forms.controller 7、attachments.controller 6、templates.controller 4、case-access.service 9）。
- web 未動，未跑。

## 後續
- #47（案件詳情頁前端）可直接串：填表單 `GET /steps/:stepId/forms` + `POST /forms/submissions`、簽核 approve/reject、附件 `GET/POST /attachments`、範本 `GET /steps/:stepId/templates`。
- progress.md 主表「8.2~10.1 待辦」列已過時（8.2〖8.7 實際已 done，見各 progress-*.md notes）；依慣例以 notes 檔為準。
