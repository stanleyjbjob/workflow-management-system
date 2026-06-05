import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CaseStatus, FlowType, StepInstanceStatus } from '@prisma/client';
import { WorkflowService } from './workflow.service';

/**
 * 以記憶體假 Prisma 驗證 WorkflowService 的編排（建立／推進／退回循環），
 * 不需真實資料庫即可在 CI 跑綠。
 */
class FakePrisma {
  private seq = 0;
  workflows: any[] = [];
  cases: any[] = [];
  stepInstances: any[] = [];

  private id(p: string) {
    this.seq += 1;
    return `${p}${this.seq}`;
  }

  seedWorkflow(flowType: FlowType, steps: Array<{ order: number; name: string; role: string | null }>) {
    const wfId = this.id('wf-');
    const stepDefs = steps.map((s) => ({
      id: this.id('sd-'),
      workflowId: wfId,
      order: s.order,
      name: s.name,
      description: null,
      responsibleRoleId: s.role,
      nextStepId: null,
      isOptional: false,
      createdAt: new Date(),
    }));
    this.workflows.push({ id: wfId, flowType, name: 'WF', steps: stepDefs });
    return { wfId, stepDefs };
  }

  workflowDefinition = {
    findUnique: async ({ where }: any) => {
      const wf = this.workflows.find((w) => w.id === where.id);
      return wf ? { ...wf, steps: [...wf.steps] } : null;
    },
  };

  case = {
    create: async ({ data }: any) => {
      const row = { id: this.id('case-'), currentStepInstanceId: null, ...data };
      this.cases.push(row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const row = this.cases.find((c) => c.id === where.id);
      Object.assign(row, data);
      return { ...row };
    },
    findUnique: async ({ where }: any) => {
      const row = this.cases.find((c) => c.id === where.id);
      if (!row) return null;
      const wf = this.workflows.find((w) => w.id === row.workflowId);
      return {
        ...row,
        workflow: { steps: [...wf.steps] },
        stepInstances: this.stepInstances
          .filter((i) => i.caseId === row.id)
          .map((i) => ({ ...i })),
      };
    },
  };

  stepInstance = {
    create: async ({ data }: any) => {
      const row = {
        id: this.id('si-'),
        assigneeId: null,
        startedAt: null,
        completedAt: null,
        note: null,
        dueDate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      this.stepInstances.push(row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const row = this.stepInstances.find((i) => i.id === where.id);
      Object.assign(row, data);
      return { ...row };
    },
  };

  $transaction = async (cb: any) => cb(this);
}

function makeService() {
  const prisma = new FakePrisma();
  const svc = new WorkflowService(prisma as any);
  return { prisma, svc };
}

describe('WorkflowService', () => {
  it('建立案件：物化全部步驟、第一步 IN_PROGRESS 並設為目前步驟', async () => {
    const { prisma, svc } = makeService();
    const { wfId, stepDefs } = prisma.seedWorkflow(FlowType.SALES, [
      { order: 1, name: '報價', role: 'r-sales' },
      { order: 2, name: '簽核', role: 'r-consultant' },
      { order: 3, name: '開發', role: 'r-engineer' },
    ]);

    const state = await svc.createCaseFromWorkflow({ workflowId: wfId, title: 'A 客戶案' });

    expect(state.status).toBe(CaseStatus.IN_PROGRESS);
    expect(state.steps).toHaveLength(3);
    expect(state.steps[0].status).toBe(StepInstanceStatus.IN_PROGRESS);
    expect(state.steps[1].status).toBe(StepInstanceStatus.PENDING);
    expect(state.currentStepDefinitionId).toBe(stepDefs[0].id);
    expect(state.code).toMatch(/^SALES-/);
  });

  it('逐步推進到完成；轉換帶出下一步負責角色', async () => {
    const { prisma, svc } = makeService();
    const { wfId, stepDefs } = prisma.seedWorkflow(FlowType.SALES, [
      { order: 1, name: '報價', role: 'r-sales' },
      { order: 2, name: '簽核', role: 'r-consultant' },
    ]);
    let state = await svc.createCaseFromWorkflow({ workflowId: wfId, title: 'B' });

    state = await svc.advanceCase(state.caseId, { assigneeId: 'u-consultant' });
    expect(state.currentStepDefinitionId).toBe(stepDefs[1].id);
    const cur = state.steps.find((s) => s.stepDefinitionId === stepDefs[1].id)!;
    expect(cur.status).toBe(StepInstanceStatus.IN_PROGRESS);
    expect(cur.responsibleRoleId).toBe('r-consultant');
    expect(cur.assigneeId).toBe('u-consultant');
    expect(state.steps[0].status).toBe(StepInstanceStatus.COMPLETED);

    state = await svc.advanceCase(state.caseId);
    expect(state.status).toBe(CaseStatus.COMPLETED);
    expect(state.currentStepInstanceId).toBeNull();
    expect(state.steps.every((s) => s.status === StepInstanceStatus.COMPLETED)).toBe(true);
  });

  it('退回循環：開發退回簽核，目標重啟為 IN_PROGRESS、退回步驟留存原因，可再前進', async () => {
    const { prisma, svc } = makeService();
    const { wfId, stepDefs } = prisma.seedWorkflow(FlowType.CUSTOMIZATION, [
      { order: 1, name: '需求', role: 'r-consultant' },
      { order: 2, name: '開發', role: 'r-engineer' },
      { order: 3, name: '複測', role: 'r-consultant' },
    ]);
    let state = await svc.createCaseFromWorkflow({ workflowId: wfId, title: 'C' });
    state = await svc.advanceCase(state.caseId); // → 開發
    state = await svc.advanceCase(state.caseId); // → 複測
    expect(state.currentStepDefinitionId).toBe(stepDefs[2].id);

    // 複測不過，退回開發
    state = await svc.returnCase(state.caseId, stepDefs[1].id, { reason: '複測未通過' });
    expect(state.currentStepDefinitionId).toBe(stepDefs[1].id);
    const dev = state.steps.find((s) => s.stepDefinitionId === stepDefs[1].id)!;
    const retest = state.steps.find((s) => s.stepDefinitionId === stepDefs[2].id)!;
    expect(dev.status).toBe(StepInstanceStatus.IN_PROGRESS);
    expect(retest.status).toBe(StepInstanceStatus.RETURNED);
    expect(state.status).toBe(CaseStatus.IN_PROGRESS);

    // 修正後再次前進回複測（循環）
    state = await svc.advanceCase(state.caseId);
    expect(state.currentStepDefinitionId).toBe(stepDefs[2].id);
    expect(state.steps.find((s) => s.stepDefinitionId === stepDefs[2].id)!.status).toBe(
      StepInstanceStatus.IN_PROGRESS,
    );
  });

  it('不存在的流程 → NotFound；引擎錯誤 → BadRequest', async () => {
    const { prisma, svc } = makeService();
    await expect(svc.createCaseFromWorkflow({ workflowId: 'ghost', title: 'X' })).rejects.toThrow(
      NotFoundException,
    );
    const { wfId } = prisma.seedWorkflow(FlowType.SALES, [
      { order: 1, name: '只有一步', role: null },
    ]);
    const state = await svc.createCaseFromWorkflow({ workflowId: wfId, title: 'Y' });
    // 退回目標不存在 → 引擎錯誤 → BadRequest
    await expect(svc.returnCase(state.caseId, 'no-such-step', { reason: 'x' })).rejects.toThrow(
      BadRequestException,
    );
  });
});
