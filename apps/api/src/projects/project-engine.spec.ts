import { FlowType, ProjectStatus } from '@prisma/client';
import {
  PROJECT_CODE_PREFIX,
  ProjectEngineError,
  assertStatusTransition,
  averageProgress,
  buildFlowMount,
  buildProjectDraft,
  buildProjectPatch,
  canTransitionStatus,
  computeStepCompletionProgress,
  flowsOverlap,
  generateProjectCode,
  normalizeProgress,
} from './project-engine';

const D = (s: string): Date => new Date(s);

describe('專案代碼產生 generateProjectCode', () => {
  it('格式為 PRJ-YYYYMM-#### 且序號補零 4 位（UTC）', () => {
    expect(generateProjectCode({ now: D('2026-06-06T00:00:00Z'), sequence: 1 })).toBe('PRJ-202606-0001');
    expect(generateProjectCode({ now: D('2026-12-31T16:00:00Z'), sequence: 42 })).toBe('PRJ-202612-0042');
  });

  it('前綴常數一致', () => {
    expect(generateProjectCode({ now: D('2026-01-01T00:00:00Z'), sequence: 1 }).startsWith(PROJECT_CODE_PREFIX + '-')).toBe(true);
  });

  it('sequence 非正整數拋 invalid_sequence', () => {
    for (const bad of [0, -1, NaN]) {
      try {
        generateProjectCode({ now: D('2026-06-06T00:00:00Z'), sequence: bad });
        throw new Error('should throw for ' + bad);
      } catch (e) {
        expect((e as ProjectEngineError).code).toBe('invalid_sequence');
      }
    }
  });
});

describe('專案建立輸入 buildProjectDraft', () => {
  const ok = {
    name: '  傑報導入案  ',
    client: ' 某客戶 ',
    ownerId: ' u-owner ',
    planStart: '2026-06-01',
    planEnd: '2026-09-30',
  };

  it('合法輸入：去頭尾空白並轉 Date', () => {
    const r = buildProjectDraft(ok);
    expect(r.name).toBe('傑報導入案');
    expect(r.client).toBe('某客戶');
    expect(r.ownerId).toBe('u-owner');
    expect(r.planStart.getTime()).toBe(D('2026-06-01').getTime());
    expect(r.planEnd.getTime()).toBe(D('2026-09-30').getTime());
  });

  it('缺 name / client / owner 各自拋對應 code', () => {
    expect(() => buildProjectDraft({ ...ok, name: '   ' })).toThrow(ProjectEngineError);
    try { buildProjectDraft({ ...ok, name: '' }); } catch (e) { expect((e as ProjectEngineError).code).toBe('name_required'); }
    try { buildProjectDraft({ ...ok, client: '' }); } catch (e) { expect((e as ProjectEngineError).code).toBe('client_required'); }
    try { buildProjectDraft({ ...ok, ownerId: '' }); } catch (e) { expect((e as ProjectEngineError).code).toBe('owner_required'); }
  });

  it('缺日期拋 invalid_date；非法日期亦拋 invalid_date', () => {
    try { buildProjectDraft({ ...ok, planStart: null }); } catch (e) { expect((e as ProjectEngineError).code).toBe('invalid_date'); }
    try { buildProjectDraft({ ...ok, planEnd: 'not-a-date' }); } catch (e) { expect((e as ProjectEngineError).code).toBe('invalid_date'); }
  });

  it('planEnd 早於 planStart 拋 invalid_plan_window', () => {
    try {
      buildProjectDraft({ ...ok, planStart: '2026-09-30', planEnd: '2026-06-01' });
      throw new Error('should throw');
    } catch (e) {
      expect((e as ProjectEngineError).code).toBe('invalid_plan_window');
    }
  });

  it('planStart === planEnd 視為合法（單日專案）', () => {
    const r = buildProjectDraft({ ...ok, planStart: '2026-06-01', planEnd: '2026-06-01' });
    expect(r.planStart.getTime()).toBe(r.planEnd.getTime());
  });
});

describe('專案部分更新 buildProjectPatch', () => {
  const current = { planStart: D('2026-06-01'), planEnd: D('2026-09-30') };

  it('只更新提供的欄位', () => {
    const patch = buildProjectPatch({ name: ' 新名 ' }, current);
    expect(patch).toEqual({ name: '新名' });
  });

  it('空字串欄位拋對應 required', () => {
    try { buildProjectPatch({ client: '  ' }, current); } catch (e) { expect((e as ProjectEngineError).code).toBe('client_required'); }
  });

  it('只更新 planStart 但晚於現有 planEnd 拋 invalid_plan_window', () => {
    try {
      buildProjectPatch({ planStart: '2026-12-31' }, current);
      throw new Error('should throw');
    } catch (e) {
      expect((e as ProjectEngineError).code).toBe('invalid_plan_window');
    }
  });

  it('同時更新起迄且合法', () => {
    const patch = buildProjectPatch({ planStart: '2026-07-01', planEnd: '2026-08-01' }, current);
    expect(patch.planStart?.getTime()).toBe(D('2026-07-01').getTime());
    expect(patch.planEnd?.getTime()).toBe(D('2026-08-01').getTime());
  });

  it('未提供任何欄位回空 patch', () => {
    expect(buildProjectPatch({}, current)).toEqual({});
  });
});

describe('專案狀態機 canTransitionStatus / assertStatusTransition', () => {
  it('ACTIVE 可轉 ON_HOLD / COMPLETED / CANCELLED', () => {
    expect(canTransitionStatus(ProjectStatus.ACTIVE, ProjectStatus.ON_HOLD)).toBe(true);
    expect(canTransitionStatus(ProjectStatus.ACTIVE, ProjectStatus.COMPLETED)).toBe(true);
    expect(canTransitionStatus(ProjectStatus.ACTIVE, ProjectStatus.CANCELLED)).toBe(true);
  });

  it('ON_HOLD 可回 ACTIVE', () => {
    expect(canTransitionStatus(ProjectStatus.ON_HOLD, ProjectStatus.ACTIVE)).toBe(true);
  });

  it('COMPLETED / CANCELLED 為終態', () => {
    for (const to of Object.values(ProjectStatus)) {
      if (to === ProjectStatus.COMPLETED) continue;
      expect(canTransitionStatus(ProjectStatus.COMPLETED, to)).toBe(false);
    }
    for (const to of Object.values(ProjectStatus)) {
      if (to === ProjectStatus.CANCELLED) continue;
      expect(canTransitionStatus(ProjectStatus.CANCELLED, to)).toBe(false);
    }
  });

  it('相同狀態冪等視為合法', () => {
    expect(canTransitionStatus(ProjectStatus.COMPLETED, ProjectStatus.COMPLETED)).toBe(true);
  });

  it('assertStatusTransition 非法拋 invalid_status_transition', () => {
    try {
      assertStatusTransition(ProjectStatus.COMPLETED, ProjectStatus.ACTIVE);
      throw new Error('should throw');
    } catch (e) {
      expect((e as ProjectEngineError).code).toBe('invalid_status_transition');
    }
  });
});

describe('掛載流程 buildFlowMount（允許先後與重疊）', () => {
  const base = { flowType: FlowType.ONBOARDING, name: '系統導入', planStart: '2026-06-10', planEnd: '2026-07-10' };

  it('合法輸入正規化、progress 預設 0', () => {
    const r = buildFlowMount(base);
    expect(r.flowType).toBe(FlowType.ONBOARDING);
    expect(r.name).toBe('系統導入');
    expect(r.caseId).toBeNull();
    expect(r.progress).toBe(0);
  });

  it('未指定 flowType / name 時由案件帶出', () => {
    const r = buildFlowMount(
      { planStart: '2026-06-10', planEnd: '2026-07-10', caseId: ' c-1 ' },
      { flowType: FlowType.SALES, name: '銷售案件A' },
    );
    expect(r.flowType).toBe(FlowType.SALES);
    expect(r.name).toBe('銷售案件A');
    expect(r.caseId).toBe('c-1');
  });

  it('缺 flowType 拋 flow_type_required', () => {
    try { buildFlowMount({ name: 'x', planStart: '2026-06-10', planEnd: '2026-07-10' }); }
    catch (e) { expect((e as ProjectEngineError).code).toBe('flow_type_required'); }
  });

  it('缺 name 拋 flow_name_required', () => {
    try { buildFlowMount({ flowType: FlowType.SALES, planStart: '2026-06-10', planEnd: '2026-07-10' }); }
    catch (e) { expect((e as ProjectEngineError).code).toBe('flow_name_required'); }
  });

  it('流程 planEnd 早於 planStart 拋 invalid_plan_window', () => {
    try { buildFlowMount({ ...base, planStart: '2026-07-10', planEnd: '2026-06-10' }); }
    catch (e) { expect((e as ProjectEngineError).code).toBe('invalid_plan_window'); }
  });

  it('progress 夾擠至 0..100 並四捨五入', () => {
    expect(buildFlowMount({ ...base, progress: 150 }).progress).toBe(100);
    expect(buildFlowMount({ ...base, progress: -5 }).progress).toBe(0);
    expect(buildFlowMount({ ...base, progress: 33.6 }).progress).toBe(34);
  });
});

describe('flowsOverlap（先後與重疊判斷）', () => {
  const a = { planStart: D('2026-06-01'), planEnd: D('2026-06-30') };
  it('重疊回 true（含端點相接）', () => {
    expect(flowsOverlap(a, { planStart: D('2026-06-15'), planEnd: D('2026-07-15') })).toBe(true);
    expect(flowsOverlap(a, { planStart: D('2026-06-30'), planEnd: D('2026-07-10') })).toBe(true);
  });
  it('完全先後不重疊回 false', () => {
    expect(flowsOverlap(a, { planStart: D('2026-07-01'), planEnd: D('2026-07-31') })).toBe(false);
  });
});

describe('進度計算', () => {
  it('computeStepCompletionProgress：完成數 ÷ 計入步驟（排除 SKIPPED）', () => {
    expect(computeStepCompletionProgress([])).toBe(0);
    expect(
      computeStepCompletionProgress([
        { status: 'COMPLETED' }, { status: 'COMPLETED' },
        { status: 'IN_PROGRESS' }, { status: 'PENDING' },
      ]),
    ).toBe(50);
    // SKIPPED 不計入分母
    expect(
      computeStepCompletionProgress([
        { status: 'COMPLETED' }, { status: 'SKIPPED' }, { status: 'PENDING' },
      ]),
    ).toBe(50);
  });

  it('全 SKIPPED 回 0（無計入步驟）', () => {
    expect(computeStepCompletionProgress([{ status: 'SKIPPED' }, { status: 'SKIPPED' }])).toBe(0);
  });

  it('averageProgress：各流程平均、無流程回 0', () => {
    expect(averageProgress([])).toBe(0);
    expect(averageProgress([{ progress: 100 }, { progress: 0 }])).toBe(50);
    expect(averageProgress([{ progress: 30 }, { progress: 30 }, { progress: 31 }])).toBe(30);
  });
});

describe('normalizeProgress', () => {
  it('null/undefined 回 0；非有限值拋 invalid_progress', () => {
    expect(normalizeProgress(null)).toBe(0);
    expect(normalizeProgress(undefined)).toBe(0);
    try { normalizeProgress(Infinity); } catch (e) { expect((e as ProjectEngineError).code).toBe('invalid_progress'); }
  });
});
