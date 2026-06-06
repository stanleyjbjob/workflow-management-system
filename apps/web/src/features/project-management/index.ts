/**
 * @deprecated 本資料夾為 5.6 早期「平行實作」誤建（基於過時的本機 clone）。
 * 5.6 專案↔案件雙向導覽已正式整併進 `../project-gantt`（ProjectWorkspace / CaseDetailPanel / cases）。
 * 此 index 僅保留為相容轉出，指向正統實作；其餘檔案為未被引用之死碼，待人類刪除
 *（GitHub 連接器無刪檔能力，無法於排程中移除）。請勿在新程式中引用本資料夾。
 */
export { ProjectWorkspace as ProjectManagement } from '../project-gantt';
export type { ProjectWorkspaceProps as ProjectManagementProps } from '../project-gantt';
