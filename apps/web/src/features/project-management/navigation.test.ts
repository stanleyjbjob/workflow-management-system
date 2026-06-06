import { describe, expect, it } from 'vitest';
import {
  canJumpToCase,
  dayNum,
  expectedProgress,
  findFlowsReferencingCase,
  flowStatus,
  ganttGeometry,
  overallProgress,
  projectKpis,
  resolveCaseFromFlow,
  resolveProjectFromCase,
} from './navigation';
import { seedCases, seedProjects } from './seed';
import type { ProjectFlow } from './types';

const TODAY = '2026-06-06';
const mkFlow = (over: Partial<ProjectFlow> = {}): ProjectFlow => ({
  flowId: 'f',
  flowType: 'ONBOARDING',
  name: '測試流程',
  planStart: '2026-06-01',
  planEnd: '2026-06-11',
  progress: 50,
  ...over,
});

describe('dayNum', () => {
  it('相鄰日期序號差 1，且與時區無關', () => {
    expect(dayNum('2026-06-07') - dayNum('2026-06-06')).toBe(1);
  });
});

describe('expectedProgress（§4.2）', () => {
  it('開始前為 0、結束後為 100、中點約 50', () => {
    expect(expectedProgress(mkFlow(), '2026-05-01')).toBe(0);
    expect(expectedProgress(mkFlow(), '2026-07-01')).toBe(100);
    expect(Math.round(expectedProgress(mkFlow(), '2026-06-06'))).toBe(50);
  });
});

describe('flowStatus（§4.3）', () => {
  it('progress>=100 為完成', () => {
    expect(flowStatus(mkFlow({ progress: 100 }), TODAY).kind).toBe('COMPLETED');
  });
  it('今日早於開始為未開始', () => {
    expect(flowStatus(mkFlow({ planStart: '2026-07-01', planEnd: '2026-07-20' }), TODAY).kind).toBe('NOT_STARTED');
  });
  it('落後超過門檻為延遲（delta<-8）', () => {
    const s = flowStatus(mkFlow({ progress: 20 }), TODAY); // expected≈50
    expect(s.kind).toBe('DELAYED');
    expect(s.deltaPct).toBeLessThan(-8);
  });
  it('領先超過門檻為超前（delta>8）', () => {
    const s = flowStatus(mkFlow({ progress: 80 }), TODAY);
    expect(s.kind).toBe('AHEAD');
    expect(s.deltaPct).toBeGreaterThan(8);
  });
  it('差距落在門檻內為準時', () => {
    expect(flowStatus(mkFlow({ progress: 50 }), TODAY).kind).toBe('ON_TIME');
  });
});

// === issue 5.6：專案↔案件雙向導覽 ===
describe('canJumpToCase（無對應案件之流程不提供跳轉 §5.3）', () => {
  it('有 caseRef 且案件存在 → 可跳轉', () => {
    expect(canJumpToCase(mkFlow({ caseRef: 'c2' }), seedCases)).toBe(true);
  });
  it('無 caseRef → 不可跳轉', () => {
    expect(canJumpToCase(mkFlow({ caseRef: null }), seedCases)).toBe(false);
    expect(canJumpToCase(mkFlow({}), seedCases)).toBe(false);
  });
  it('caseRef 指向不存在的案件 → 不可跳轉', () => {
    expect(canJumpToCase(mkFlow({ caseRef: 'ghost' }), seedCases)).toBe(false);
  });
});

describe('resolveCaseFromFlow（甘特圖流程列 → 案件詳情）', () => {
  it('回傳對應案件', () => {
    const f = seedProjects.p1.flows.find((x) => x.caseRef === 'c2')!;
    expect(resolveCaseFromFlow(f, seedCases)?.id).toBe('c2');
  });
  it('不可跳轉時回傳 null', () => {
    const f = seedProjects.p1.flows.find((x) => x.caseRef == null)!;
    expect(resolveCaseFromFlow(f, seedCases)).toBeNull();
  });
});

describe('resolveProjectFromCase（案件詳情「所屬專案」→ 反向跳回專案）', () => {
  it('c2 反向解析回專案 p1', () => {
    expect(resolveProjectFromCase(seedCases.c2, seedProjects)?.id).toBe('p1');
  });
  it('未指派專案（projectId=null）回傳 null', () => {
    expect(resolveProjectFromCase(seedCases.c1, seedProjects)).toBeNull();
  });
});

describe('雙向往返一致性（round-trip）', () => {
  it('專案流程 → 案件 → 回專案，回到同一專案', () => {
    const p = seedProjects.p1;
    const flow = p.flows.find((f) => canJumpToCase(f, seedCases))!;
    const c = resolveCaseFromFlow(flow, seedCases)!;
    expect(resolveProjectFromCase(c, seedProjects)?.id).toBe(p.id);
  });
});

describe('findFlowsReferencingCase', () => {
  it('c4 被 p1 的客製化流程引用', () => {
    const refs = findFlowsReferencingCase('c4', seedProjects);
    expect(refs.map((r) => r.project.id)).toContain('p1');
  });
});

describe('ganttGeometry（§5.2）', () => {
  it('每條流程一根長條，今日基準線落在 0..100', () => {
    const g = ganttGeometry(seedProjects.p1, TODAY, seedCases);
    expect(g.bars).toHaveLength(seedProjects.p1.flows.length);
    expect(g.todayLeftPct).not.toBeNull();
    expect(g.todayLeftPct!).toBeGreaterThanOrEqual(0);
    expect(g.todayLeftPct!).toBeLessThanOrEqual(100);
  });
  it('jumpable 旗標與 caseRef 對應', () => {
    const g = ganttGeometry(seedProjects.p1, TODAY, seedCases);
    const withCase = g.bars.find((b) => b.flow.caseRef === 'c2')!;
    const noCase = g.bars.find((b) => b.flow.caseRef == null)!;
    expect(withCase.jumpable).toBe(true);
    expect(noCase.jumpable).toBe(false);
  });
  it('排除日產生對應網底區塊', () => {
    expect(ganttGeometry(seedProjects.p1, TODAY).bands).toHaveLength(1);
    expect(ganttGeometry(seedProjects.p2, TODAY).bands).toHaveLength(0);
  });
});

describe('KPI（§5.1）', () => {
  it('overallProgress 為各流程平均', () => {
    expect(overallProgress(seedProjects.p1)).toBe(Math.round((100 + 28 + 42 + 0) / 4));
  });
  it('projectKpis 統計排除日區間數', () => {
    expect(projectKpis(seedProjects.p1, TODAY).exclusionRanges).toBe(1);
  });
});
