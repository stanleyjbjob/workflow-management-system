import { describe, expect, it } from 'vitest';
import {
  belongsToProject,
  canJumpToCase,
  canJumpToProject,
  jumpableRows,
  resolveCaseFromRow,
  type CaseSummary,
} from './cases';
import { sampleCases } from './seed-cases';
import { sampleProjectGantt } from './seed';
import type { GanttRow } from './types';

const rows = sampleProjectGantt.view.rows;
const rowWithCase = (): GanttRow => rows.find((r) => r.caseId === 'CASE-CUS-001')!;
const rowNoCase = (): GanttRow => rows.find((r) => r.caseId === null)!; // 教育訓練

describe('canJumpToCase（§5.3：無對應案件之流程不提供跳轉）', () => {
  it('列有 caseId 且案件存在 → 可跳轉', () => {
    expect(canJumpToCase(rowWithCase(), sampleCases)).toBe(true);
  });
  it('列 caseId=null → 不可跳轉', () => {
    expect(canJumpToCase(rowNoCase(), sampleCases)).toBe(false);
  });
  it('caseId 指向不存在的案件 → 不可跳轉', () => {
    const ghost = { ...rowWithCase(), caseId: 'CASE-GHOST' };
    expect(canJumpToCase(ghost, sampleCases)).toBe(false);
  });
});

describe('resolveCaseFromRow（甘特圖流程列 → 案件詳情）', () => {
  it('回傳對應案件', () => {
    expect(resolveCaseFromRow(rowWithCase(), sampleCases)?.caseId).toBe('CASE-CUS-001');
  });
  it('不可跳轉時回傳 null', () => {
    expect(resolveCaseFromRow(rowNoCase(), sampleCases)).toBeNull();
  });
  it('seed 中每個有 caseId 的列都能解析到案件', () => {
    for (const r of rows) {
      if (r.caseId !== null) expect(resolveCaseFromRow(r, sampleCases)).not.toBeNull();
    }
  });
});

describe('反向導覽：案件「所屬專案」→ 跳回專案', () => {
  it('有 projectCode → 可跳回', () => {
    expect(canJumpToProject(sampleCases['CASE-CUS-001'])).toBe(true);
  });
  it('未指派專案（projectCode=null）→ 不可跳回', () => {
    const orphan: CaseSummary = { ...sampleCases['CASE-CUS-001'], projectCode: null, projectName: null };
    expect(canJumpToProject(orphan)).toBe(false);
  });
  it('belongsToProject 與目前專案表頭相符', () => {
    expect(belongsToProject(sampleCases['CASE-CUS-001'], sampleProjectGantt.project)).toBe(true);
  });
});

describe('雙向往返一致性（round-trip）', () => {
  it('甘特列 → 案件 → 所屬專案，回到目前專案', () => {
    const c = resolveCaseFromRow(rowWithCase(), sampleCases)!;
    expect(belongsToProject(c, sampleProjectGantt.project)).toBe(true);
  });
});

describe('jumpableRows', () => {
  it('排除 caseId=null 的列（教育訓練）', () => {
    const js = jumpableRows(rows, sampleCases);
    expect(js.every((r) => r.caseId !== null)).toBe(true);
    expect(js).toHaveLength(rows.filter((r) => r.caseId !== null).length);
  });
});
