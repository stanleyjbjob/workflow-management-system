/**
 * 案件詳情 + 專案↔案件雙向導覽（issue #28，5.6 / 專案管理模組規格 §5.3）。
 *
 * 純邏輯（無 React/DOM 相依，可純函式測試），與本 feature 其餘純函式同風格。
 * 甘特圖列（GanttRow）已帶 `caseId`（後端 gantt-engine 既有欄位）；本檔提供：
 *  - 由列解析對應案件（流程列 → 案件詳情）。
 *  - 由案件解析所屬專案（案件「所屬專案」→ 反向跳回專案）。
 *  - 「無對應案件之流程不提供跳轉」之判斷（§5.3）。
 *
 * 案件資料來源待 REST 層就緒後改以 fetch；本輪先以 seed 範例驅動 UI。
 */
import type { GanttRow, ProjectHeader } from './types';

export interface CaseStep {
  name: string;
  role: string;
  done: boolean;
  active?: boolean;
  forms: string[];
  description: string;
}

export interface CaseSummary {
  caseId: string;
  projectCode: string | null; // 所屬專案代碼；null = 未指派專案
  projectName: string | null;
  title: string;
  meta: string;
  flowLabel: string;
  tags: string[];
  steps: CaseStep[];
}

// 甘特圖流程列是否可跳轉案件：需有 caseId 且該案件存在
// （§5.3「無對應案件之流程不提供跳轉」）
export function canJumpToCase(row: GanttRow, cases: Record<string, CaseSummary>): boolean {
  const id = row.caseId;
  return id != null && id !== '' && Object.prototype.hasOwnProperty.call(cases, id);
}

// 流程列 → 案件詳情（不可跳轉時回傳 null）
export function resolveCaseFromRow(
  row: GanttRow,
  cases: Record<string, CaseSummary>,
): CaseSummary | null {
  if (!canJumpToCase(row, cases)) return null;
  return cases[row.caseId as string];
}

// 案件「所屬專案」是否可反向跳回（未指派專案則否）
export function canJumpToProject(caseSummary: CaseSummary): boolean {
  return caseSummary.projectCode != null && caseSummary.projectCode !== '';
}

// 案件之所屬專案是否即為目前檢視專案（反向跳回的一致性檢查）
export function belongsToProject(caseSummary: CaseSummary, project: ProjectHeader): boolean {
  return caseSummary.projectCode === project.code;
}

// 反查：目前甘特圖中有哪些列可跳轉案件
export function jumpableRows(
  rows: GanttRow[],
  cases: Record<string, CaseSummary>,
): GanttRow[] {
  return rows.filter((r) => canJumpToCase(r, cases));
}
