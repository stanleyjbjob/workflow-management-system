import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CaseStatus, FlowType, StepInstanceStatus, SubmissionStatus } from '@prisma/client';
import { AccessScopeService } from '../rbac/access-scope.service';
import { SessionUser } from '../auth/auth.service';
import { CasesService } from './cases.service';

/**
 * 以記憶體假 Prisma + 假 WorkflowService 驗證 CasesService 的
 * 範圍收斂（caseWhere 注入）、詳情彙整（步驟×表單狀態×附件）與推進/退回包裝，
 * 不需真實資料庫即可在 CI 跑綠。
 */

const manager: SessionUser = {
  sub: 'u-mgr',
  email: 'mgr@x',
  name: '主管',
  roles: ['MANAGER'],
};
const sales: SessionUser = {
  sub: 'u-sales',
  email: 's@x',
  name: '業務',
  roles: ['SALES'],
};
const engineer: SessionUser = {
  sub: 'u-eng',
  email: 'e@x',
  name: '工程',
  roles: ['ENGINEER'],
};

interface FakeData {
  caseRow: any;
  attachments: any[];
}

function buildSeed(): FakeData {
  const formA = { id: 'fd-A', code: 'FORM_A', name: '需求表', isSignable: false };
  const formB = { id: 'fd-B', code: 'FORM_B', name: '簽核表', isSignable: true };
  const step1 = {
    id: 'sd-1',
    order: 1,
    name: '洽談',
    description: '初洽',
    responsibleRoleId: 'role-sales',
    responsibleRole: { id: 'role-sales', name: '業務' },
    forms: [
      { stepId: 'sd-1', formId: 'fd-A', isRequired: true, form: formA },
      { stepId: 'sd-1', formId: 'fd-B', isRequired: true, form: formB },
    ],
  };
  const step2 = {
    id: 'sd-2',
    order: 2,
    name: '報價',
    description: null,
    responsibleRoleId: null,
    responsibleRole: null,
    forms: [],
  };
  const inst1 = {
    id: 'si-1',
    stepDefinitionId: 'sd-1',
    order: 1,
    status: StepInstanceStatus.COMPLETED,
    assigneeId: 'u-sales',
    assignee: { id: 'u-sales', displayName: '業務' },
    dueDate: new Date('2026-06-15T00:00:00Z'),
    startedAt: new Date('2026-06-01T00:00:00Z'),
    completedAt: new Date('2026-06-02T00:00:00Z'),
    note: null,
  };
  const inst2 = {
    id: 'si-2',
    stepDefinitionId: 'sd-2',
    order: 2,
    status: StepInstanceStatus.IN_PROGRESS,
    assigneeId: null,
    assignee: null,
    dueDate: null,
    startedAt: new Date('2026-06-02T00:00:00Z'),
    completedAt: null,
    note: null,
  };
  const caseRow = {
    id: 'case-1',
    code: 'SALES-20260601-AB12C',
    title: '示例案件',
    flowType: FlowType.SALES,
    status: CaseStatus.IN_PROGRESS,
    clientName: '客戶',
    saleMode: null,
    failureReason: null,
    assigneeId: 'u-sales',
    createdById: 'u-sales',
    currentStepInstanceId: 'si-2',
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-02T00:00:00Z'),
    workflow: { id: 'wf-1', name: '銷售流程', version: 1, steps: [step2, step1] },
    stepInstances: [inst2, inst1],
    submissions: [
      // FORM_A：先 DRAFT 後 SUBMITTED（取最佳 SUBMITTED）
      {
        id: 'sub-1',
        formDefinitionId: 'fd-A',
        stepInstanceId: 'si-1',
        status: SubmissionStatus.DRAFT,
        submittedAt: null,
        approvedAt: null,
        createdAt: new Date('2026-06-01T01:00:00Z'),
      },
      {
        id: 'sub-2',
        formDefinitionId: 'fd-A',
        stepInstanceId: 'si-1',
        status: SubmissionStatus.SUBMITTED,
        submittedAt: new Date('2026-06-01T02:00:00Z'),
        approvedAt: null,
        createdAt: new Date('2026-06-01T02:00:00Z'),
      },
      // FORM_B（可簽核）：僅 SUBMITTED → 未達成
      {
        id: 'sub-3',
        formDefinitionId: 'fd-B',
        stepInstanceId: 'si-1',
        status: SubmissionStatus.SUBMITTED,
        submittedAt: new Date('2026-06-01T03:00:00Z'),
        approvedAt: null,
        createdAt: new Date('2026-06-01T03:00:00Z'),
      },
    ],
    assignee: { id: 'u-sales', displayName: '業務' },
    createdBy: { id: 'u-sales', displayName: '業務' },
  };
  const attachments = [
    {
      id: 'att-1',
      type: 'FILE',
      name: '報價單.pdf',
      fileUrl: '/files/q.pdf',
      linkUrl: null,
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      version: 1,
      stepInstanceId: 'si-1',
      formSubmissionId: null,
      createdAt: new Date('2026-06-01T04:00:00Z'),
    },
  ];
  return { caseRow, attachments };
}

class FakePrisma {
  findManyArgs: any[] = [];
  constructor(private readonly data: FakeData | null) {}

  case = {
    findMany: async (args: any) => {
      this.findManyArgs.push(args);
      return [];
    },
    findUnique: async (_args: any) => {
      if (!this.data) return null;
      return JSON.parse(JSON.stringify(this.data.caseRow));
    },
  };

  attachment = {
    findMany: async (_args: any) =>
      this.data ? JSON.parse(JSON.stringify(this.data.attachments)) : [],
  };
}

class FakeWorkflow {
  calls: any[] = [];
  async advanceCase(caseId: string, opts: any) {
    this.calls.push(['advance', caseId, opts]);
    return { caseId, code: 'X', status: CaseStatus.IN_PROGRESS, currentStepInstanceId: null, currentStepDefinitionId: null, steps: [] };
  }
  async returnCase(caseId: string, target: string, opts: any) {
    this.calls.push(['return', caseId, target, opts]);
    return { caseId, code: 'X', status: CaseStatus.IN_PROGRESS, currentStepInstanceId: null, currentStepDefinitionId: null, steps: [] };
  }
}

function build(data: FakeData | null) {
  const prisma = new FakePrisma(data);
  const workflow = new FakeWorkflow();
  const service = new CasesService(
    prisma as never,
    new AccessScopeService(),
    workflow as never,
  );
  return { prisma, workflow, service };
}

describe('CasesService.list', () => {
  it('主管：範圍 where 為 {}（不設限），過濾條件以 AND 疊加', async () => {
    const { prisma, service } = build(null);
    await service.list(manager, { flowType: 'SALES', status: 'IN_PROGRESS', assigneeId: 'u-1' });
    const where = prisma.findManyArgs[0].where;
    expect(where.AND[0]).toEqual({});
    expect(where.AND).toContainEqual({ flowType: 'SALES' });
    expect(where.AND).toContainEqual({ status: 'IN_PROGRESS' });
    expect(where.AND).toContainEqual({ assigneeId: 'u-1' });
  });

  it('非主管：範圍 where 帶 OR（自己經手＋負責流程型別）', async () => {
    const { prisma, service } = build(null);
    await service.list(sales);
    const scope = prisma.findManyArgs[0].where.AND[0];
    expect(scope.OR).toContainEqual({ assigneeId: 'u-sales' });
    expect(scope.OR).toContainEqual({ createdById: 'u-sales' });
    expect(scope.OR).toContainEqual({ flowType: { in: [FlowType.SALES] } });
  });

  it('非法 flowType / status → 400', async () => {
    const { service } = build(null);
    await expect(service.list(manager, { flowType: 'NOPE' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.list(manager, { status: 'NOPE' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CasesService.detail', () => {
  it('彙整步驟（依 order 排序、帶角色/負責人/到期日）與表單狀態（最佳 submission；可簽核需 APPROVED）', async () => {
    const { service } = build(buildSeed());
    const d = await service.detail(manager, 'case-1');

    expect(d.code).toBe('SALES-20260601-AB12C');
    expect(d.workflow).toEqual({ id: 'wf-1', name: '銷售流程', version: 1 });
    expect(d.steps.map((s) => s.order)).toEqual([1, 2]);

    const s1 = d.steps[0];
    expect(s1.name).toBe('洽談');
    expect(s1.responsibleRoleName).toBe('業務');
    expect(s1.assignee).toEqual({ id: 'u-sales', displayName: '業務' });
    expect(s1.dueDate).toBe('2026-06-15T00:00:00.000Z');

    const fa = s1.forms.find((f) => f.formId === 'fd-A');
    expect(fa).toMatchObject({ status: SubmissionStatus.SUBMITTED, satisfied: true, submissionId: 'sub-2' });
    const fb = s1.forms.find((f) => f.formId === 'fd-B');
    expect(fb).toMatchObject({ status: SubmissionStatus.SUBMITTED, satisfied: false, isSignable: true });

    const s2 = d.steps[1];
    expect(s2.status).toBe(StepInstanceStatus.IN_PROGRESS);
    expect(s2.forms).toEqual([]);

    expect(d.attachments).toHaveLength(1);
    expect(d.attachments[0]).toMatchObject({ name: '報價單.pdf', stepInstanceId: 'si-1' });
    expect(d.currentStepInstanceId).toBe('si-2');
  });

  it('經手人可見；無關角色（流程型別不可見且非經手）→ 403；不存在 → 404', async () => {
    const { service } = build(buildSeed());
    await expect(service.detail(sales, 'case-1')).resolves.toBeDefined();
    await expect(service.detail(engineer, 'case-1')).rejects.toBeInstanceOf(ForbiddenException);

    const empty = build(null);
    await expect(empty.service.detail(manager, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CasesService.advance / return', () => {
  it('advance：可見者放行並轉呼 WorkflowService.advanceCase（帶 note/assigneeId）', async () => {
    const { service, workflow } = build(buildSeed());
    await service.advance(sales, 'case-1', { note: 'ok', assigneeId: 'u-next' });
    expect(workflow.calls).toEqual([['advance', 'case-1', { note: 'ok', assigneeId: 'u-next' }]]);
  });

  it('advance：不可見 → 403 且不觸發引擎', async () => {
    const { service, workflow } = build(buildSeed());
    await expect(service.advance(engineer, 'case-1', {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(workflow.calls).toHaveLength(0);
  });

  it('return：缺 targetStepDefinitionId / reason → 400；齊備則轉呼 returnCase', async () => {
    const { service, workflow } = build(buildSeed());
    await expect(service.return(sales, 'case-1', undefined, { reason: 'r' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.return(sales, 'case-1', 'sd-1', { reason: '  ' })).rejects.toBeInstanceOf(BadRequestException);

    await service.return(sales, 'case-1', 'sd-1', { reason: '複測不過' });
    expect(workflow.calls).toEqual([
      ['return', 'case-1', 'sd-1', { reason: '複測不過', assigneeId: undefined }],
    ]);
  });
});
