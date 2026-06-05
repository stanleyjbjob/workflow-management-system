import { CaseStatus, StepInstanceStatus } from '@prisma/client';
import {
  EngineStepDefinition,
  EngineStepInstance,
  WorkflowEngineError,
  firstStepDefinition,
  nextStepDefinition,
  planAdvance,
  planInitialInstances,
  planReturn,
  sortByOrder,
  validateDefinition,
} from './workflow-engine';

// 一條三步驟的流程：1 業務 → 2 顧問 → 3 工程師
function steps(): EngineStepDefinition[] {
  return [
    { id: 's1', order: 1, name: '報價', responsibleRoleId: 'r-sales' },
    { id: 's2', order: 2, name: '簽核', responsibleRoleId: 'r-consultant' },
    { id: 's3', order: 3, name: '開發', responsibleRoleId: 'r-engineer' },
  ];
}

// 由藍圖造出對應的步驟實例（id = i + stepDefId）
function instancesFrom(defs: EngineStepDefinition[]): EngineStepInstance[] {
  return planInitialInstances(defs).map((b) => ({
    id: `i-${b.stepDefinitionId}`,
    stepDefinitionId: b.stepDefinitionId,
    order: b.order,
    status: b.status,
  }));
}

describe('workflow-engine：定義驗證與排序', () => {
  it('sortByOrder 依 order 升冪且不改原陣列', () => {
    const unsorted: EngineStepDefinition[] = [
      { id: 'b', order: 3, name: 'B', responsibleRoleId: null },
      { id: 'a', order: 1, name: 'A', responsibleRoleId: null },
    ];
    expect(sortByOrder(unsorted).map((s) => s.id)).toEqual(['a', 'b']);
    expect(unsorted[0].id).toBe('b');
  });

  it('空定義 → no_steps；重複 order → duplicate_order；合法 → []', () => {
    expect(validateDefinition([])).toEqual(['no_steps']);
    expect(
      validateDefinition([
        { id: 'a', order: 1, name: 'A', responsibleRoleId: null },
        { id: 'b', order: 1, name: 'B', responsibleRoleId: null },
      ]),
    ).toEqual(['duplicate_order']);
    expect(validateDefinition(steps())).toEqual([]);
  });

  it('firstStepDefinition 取 order 最小；nextStepDefinition 走訪與終點', () => {
    expect(firstStepDefinition(steps()).id).toBe('s1');
    expect(nextStepDefinition(steps(), 1)?.id).toBe('s2');
    expect(nextStepDefinition(steps(), 2)?.id).toBe('s3');
    expect(nextStepDefinition(steps(), 3)).toBeNull();
  });

  it('planInitialInstances：第一步 IN_PROGRESS，其餘 PENDING', () => {
    const bp = planInitialInstances(steps());
    expect(bp.map((b) => b.status)).toEqual([
      StepInstanceStatus.IN_PROGRESS,
      StepInstanceStatus.PENDING,
      StepInstanceStatus.PENDING,
    ]);
    expect(bp[0].responsibleRoleId).toBe('r-sales');
  });

  it('空定義建立藍圖會丟 no_steps', () => {
    expect(() => planInitialInstances([])).toThrow(WorkflowEngineError);
  });
});

describe('workflow-engine：推進 planAdvance', () => {
  it('推進帶出下一步與其負責角色', () => {
    const defs = steps();
    const inst = instancesFrom(defs);
    const plan = planAdvance(defs, inst, 'i-s1');
    expect(plan.caseCompleted).toBe(false);
    expect(plan.completedInstanceId).toBe('i-s1');
    expect(plan.nextInstanceId).toBe('i-s2');
    expect(plan.nextStepDefinitionId).toBe('s2');
    expect(plan.nextResponsibleRoleId).toBe('r-consultant');
    expect(plan.caseStatus).toBe(CaseStatus.IN_PROGRESS);
  });

  it('最後一步推進 → 案件完成', () => {
    const defs = steps();
    const inst = instancesFrom(defs).map((i) =>
      i.id === 'i-s3' ? { ...i, status: StepInstanceStatus.IN_PROGRESS } : i,
    );
    const plan = planAdvance(defs, inst, 'i-s3');
    expect(plan.caseCompleted).toBe(true);
    expect(plan.nextInstanceId).toBeNull();
    expect(plan.caseStatus).toBe(CaseStatus.COMPLETED);
  });

  it('目前步驟非 IN_PROGRESS → current_not_active', () => {
    const defs = steps();
    const inst = instancesFrom(defs).map((i) =>
      i.id === 'i-s1' ? { ...i, status: StepInstanceStatus.PENDING } : i,
    );
    expect(() => planAdvance(defs, inst, 'i-s1')).toThrow(
      new WorkflowEngineError('current_not_active'),
    );
  });

  it('找不到目前步驟實例 → current_instance_not_found', () => {
    const defs = steps();
    expect(() => planAdvance(defs, instancesFrom(defs), 'nope')).toThrow(WorkflowEngineError);
  });

  it('下一步實例未物化 → next_instance_missing', () => {
    const defs = steps();
    const inst = instancesFrom(defs).filter((i) => i.id !== 'i-s2');
    expect(() => planAdvance(defs, inst, 'i-s1')).toThrow(
      new WorkflowEngineError('next_instance_missing'),
    );
  });
});

describe('workflow-engine：退回 planReturn（循環）', () => {
  it('從開發(s3)退回簽核(s2)，重啟目標並帶出其負責角色', () => {
    const defs = steps();
    const inst: EngineStepInstance[] = [
      { id: 'i-s1', stepDefinitionId: 's1', order: 1, status: StepInstanceStatus.COMPLETED },
      { id: 'i-s2', stepDefinitionId: 's2', order: 2, status: StepInstanceStatus.COMPLETED },
      { id: 'i-s3', stepDefinitionId: 's3', order: 3, status: StepInstanceStatus.IN_PROGRESS },
    ];
    const plan = planReturn(defs, inst, 'i-s3', 's2');
    expect(plan.returnedInstanceId).toBe('i-s3');
    expect(plan.targetInstanceId).toBe('i-s2');
    expect(plan.targetStepDefinitionId).toBe('s2');
    expect(plan.targetResponsibleRoleId).toBe('r-consultant');
  });

  it('不可退回到同層或更後面的步驟 → invalid_return_target', () => {
    const defs = steps();
    const inst: EngineStepInstance[] = [
      { id: 'i-s1', stepDefinitionId: 's1', order: 1, status: StepInstanceStatus.COMPLETED },
      { id: 'i-s2', stepDefinitionId: 's2', order: 2, status: StepInstanceStatus.IN_PROGRESS },
      { id: 'i-s3', stepDefinitionId: 's3', order: 3, status: StepInstanceStatus.PENDING },
    ];
    expect(() => planReturn(defs, inst, 'i-s2', 's3')).toThrow(
      new WorkflowEngineError('invalid_return_target'),
    );
    expect(() => planReturn(defs, inst, 'i-s2', 's2')).toThrow(
      new WorkflowEngineError('invalid_return_target'),
    );
  });

  it('目標步驟不存在 → target_step_not_found', () => {
    const defs = steps();
    const inst = instancesFrom(defs).map((i) =>
      i.id === 'i-s2' ? { ...i, status: StepInstanceStatus.IN_PROGRESS } : i,
    );
    expect(() => planReturn(defs, inst, 'i-s2', 'ghost')).toThrow(
      new WorkflowEngineError('target_step_not_found'),
    );
  });
});
