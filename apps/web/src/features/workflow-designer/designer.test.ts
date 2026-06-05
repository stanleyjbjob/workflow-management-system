import { describe, expect, it } from 'vitest';
import {
  addForm,
  addStep,
  createEmptyWorkflow,
  isSavable,
  moveStep,
  nextStepOf,
  reindex,
  removeForm,
  removeStep,
  summarize,
  updateForm,
  updateStep,
  validateWorkflow,
} from './designer';
import { seedWorkflows } from './seed';
import type { StepDraft } from './types';

describe('reindex', () => {
  it('將 order 重新編為連續 1..n', () => {
    const steps = [
      { id: 'a', order: 5 } as StepDraft,
      { id: 'b', order: 9 } as StepDraft,
      { id: 'c', order: 2 } as StepDraft,
    ];
    expect(reindex(steps).map((s) => s.order)).toEqual([1, 2, 3]);
  });
});

describe('addStep / removeStep', () => {
  it('新增步驟使 order 遞增', () => {
    let steps: StepDraft[] = [];
    steps = addStep(steps, '一');
    steps = addStep(steps, '二');
    expect(steps).toHaveLength(2);
    expect(steps.map((s) => s.order)).toEqual([1, 2]);
    expect(steps[1].name).toBe('二');
  });

  it('移除後重新編號連續', () => {
    let steps = addStep(addStep(addStep([], 'a'), 'b'), 'c');
    const midId = steps[1].id;
    steps = removeStep(steps, midId);
    expect(steps).toHaveLength(2);
    expect(steps.map((s) => s.order)).toEqual([1, 2]);
    expect(steps.find((s) => s.id === midId)).toBeUndefined();
  });
});

describe('moveStep', () => {
  it('上移 / 下移調換順序', () => {
    let steps = addStep(addStep(addStep([], 'a'), 'b'), 'c');
    const last = steps[2].id;
    steps = moveStep(steps, last, -1);
    expect(steps.map((s) => s.name)).toEqual(['a', 'c', 'b']);
    expect(steps.map((s) => s.order)).toEqual([1, 2, 3]);
  });

  it('邊界不動：首步上移無效', () => {
    const steps = addStep(addStep([], 'a'), 'b');
    const moved = moveStep(steps, steps[0].id, -1);
    expect(moved.map((s) => s.name)).toEqual(['a', 'b']);
  });
});

describe('nextStepOf', () => {
  it('回傳下一步，末步回 null', () => {
    const steps = addStep(addStep(addStep([], 'a'), 'b'), 'c');
    expect(nextStepOf(steps, steps[0].id)?.name).toBe('b');
    expect(nextStepOf(steps, steps[1].id)?.name).toBe('c');
    expect(nextStepOf(steps, steps[2].id)).toBeNull();
  });
});

describe('updateStep / forms', () => {
  it('更新步驟欄位', () => {
    let steps = addStep([], 'a');
    steps = updateStep(steps, steps[0].id, { responsibleRole: 'SALES', isOptional: true });
    expect(steps[0].responsibleRole).toBe('SALES');
    expect(steps[0].isOptional).toBe(true);
  });

  it('表單增刪改', () => {
    let steps = addStep([], 'a');
    const sid = steps[0].id;
    steps = addForm(steps, sid, '報價單');
    expect(steps[0].forms).toHaveLength(1);
    const fid = steps[0].forms[0].id;
    steps = updateForm(steps, sid, fid, { isRequired: false, isoMapping: '變更管理' });
    expect(steps[0].forms[0].isRequired).toBe(false);
    expect(steps[0].forms[0].isoMapping).toBe('變更管理');
    steps = removeForm(steps, sid, fid);
    expect(steps[0].forms).toHaveLength(0);
  });
});

describe('validateWorkflow', () => {
  it('空名稱與無步驟產生錯誤', () => {
    const wf = createEmptyWorkflow();
    const r = validateWorkflow(wf);
    expect(r.errors.some((e) => e.includes('名稱'))).toBe(true);
    expect(r.errors.some((e) => e.includes('步驟'))).toBe(true);
    expect(isSavable(wf)).toBe(false);
  });

  it('有效流程可儲存，但無角色發出警告', () => {
    const wf = createEmptyWorkflow();
    wf.name = '銷售流程';
    wf.steps = addStep([], '建立商機');
    const r = validateWorkflow(wf);
    expect(r.errors).toHaveLength(0);
    expect(isSavable(wf)).toBe(true);
    expect(r.warnings.some((w) => w.includes('負責角色'))).toBe(true);
  });
});

describe('seedWorkflows', () => {
  it('產生四大標準流程且皆可儲存', () => {
    const seeds = seedWorkflows();
    expect(seeds).toHaveLength(4);
    expect(seeds.map((w) => w.flowType)).toEqual([
      'SALES',
      'ONBOARDING',
      'ENVIRONMENT',
      'CUSTOMIZATION',
    ]);
    for (const wf of seeds) {
      expect(isSavable(wf)).toBe(true);
      expect(wf.steps.length).toBeGreaterThan(0);
    }
    const summary = summarize(seeds[0]);
    expect(summary.stepCount).toBe(seeds[0].steps.length);
  });
});
