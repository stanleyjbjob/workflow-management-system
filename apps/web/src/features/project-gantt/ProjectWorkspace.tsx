/**
 * 專案工作區（issue #28，5.6）：整合 5.5 甘特圖/簡報（ProjectGanttView）與案件詳情，
 * 串起「專案↔案件雙向導覽」（§5.3）。
 *  - 甘特圖列（有對應案件者）點擊 → 開啟案件詳情。
 *  - 案件詳情「所屬專案」→ 反向跳回專案甘特圖。
 *  - 無對應案件之流程列不提供跳轉。
 * 資料：未提供時使用 seed 範例（甘特資料 + 案件資料）。
 */
import { useState } from 'react';
import { CaseDetailPanel } from './CaseDetailPanel';
import { ProjectGanttView } from './ProjectGanttView';
import { type CaseSummary } from './cases';
import { sampleCases } from './seed-cases';
import { sampleProjectGantt } from './seed';
import type { ProjectGanttData } from './types';

export interface ProjectWorkspaceProps {
  data?: ProjectGanttData;
  cases?: Record<string, CaseSummary>;
  /** 提供時，甘特列點擊改導向統一案件詳情頁（8.12 #47）；未提供則退回內嵌 seed 側欄。 */
  onOpenCase?: (caseId: string) => void;
}

type View = { kind: 'gantt' } | { kind: 'case'; caseId: string };

export function ProjectWorkspace({
  data = sampleProjectGantt,
  cases = sampleCases,
  onOpenCase,
}: ProjectWorkspaceProps): JSX.Element {
  const [view, setView] = useState<View>({ kind: 'gantt' });

  // 甘特圖流程列 → 案件詳情：
  // 提供 onOpenCase（REST 模式）→ 統一導向案件詳情頁（8.12 #47，caseId 為真實 DB id）；
  // 否則退回內嵌 seed 側欄（僅當案件存在於 seed map；§5.3）。
  const handleSelectCase = (caseId: string): void => {
    if (onOpenCase) {
      onOpenCase(caseId);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(cases, caseId)) {
      setView({ kind: 'case', caseId });
    }
  };

  if (view.kind === 'case') {
    const caseSummary = cases[view.caseId];
    if (caseSummary) {
      return (
        <CaseDetailPanel
          caseSummary={caseSummary}
          onJumpToProject={() => setView({ kind: 'gantt' })}
          onBack={() => setView({ kind: 'gantt' })}
        />
      );
    }
  }

  return <ProjectGanttView data={data} onSelectCase={handleSelectCase} />;
}
