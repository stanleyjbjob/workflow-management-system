import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FlowType, RoleCode } from '@prisma/client';
import { guardEngine } from '../common/engine-http';
import {
  WorkflowDefinitionsService,
  WorkflowDraftDto,
} from './workflow-definitions.service';

/**
 * 以記憶體假 Prisma 驗證流程定義 CRUD 編排（issue 8.6 #41）：
 * - 草稿 round-trip（存→取→再存）不失真（含 trigger/calendar/forms/步驟 id）。
 * - update 全量替換步驟、designer Json 同步。
 * - 刪除保護：被案件引用 → 停用（軟刪）；無引用 → 實刪（步驟級聯）。
 * - 列舉／角色驗證錯誤碼經 guardEngine 轉 400 {code}。
 */
class FakePrisma {
  workflows: any[] = [];
  steps: any[] = [];
  cases: any[] = [];
  roles = Object.values(RoleCode).map((code, i) => ({ id: `role-${i + 1}`, code }));

  role = {
    findMany: async () => this.roles.map((r) => ({ ...r })),
  };

  private wfWithSteps(w: any, orderByAsc: boolean) {
    const steps = this.steps
      .filter((s) => s.workflowId === w.id)
      .sort((a, b) => (orderByAsc ? a.order - b.order : 0))
      .map((s) => ({
        ...s,
        responsibleRole: s.responsibleRoleId
          ? { code: this.roles.find((r) => r.id === s.responsibleRoleId)!.code }
          : null,
      }));
    return { ...w, steps };
  }

  workflowDefinition = {
    findMany: async (_args: any) =>
      this.workflows.map((w) => this.wfWithSteps(w, true)),
    findUnique: async ({ where, include }: any) => {
      const w = this.workflows.find((x) => x.id === where.id);
      if (!w) return null;
      return include ? this.wfWithSteps(w, true) : { ...w };
    },
    create: async ({ data }: any) => {
      if (
        this.workflows.some(
          (w) => w.flowType === data.flowType && w.name === data.name && w.version === data.version,
        )
      ) {
        const err: any = new Error('unique constraint');
        err.code = 'P2002';
        throw err;
      }
      const row = { createdAt: new Date(), updatedAt: new Date(), ...data };
      this.workflows.push(row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const row = this.workflows.find((x) => x.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data, { updatedAt: new Date() });
      return { ...row };
    },
    delete: async ({ where }: any) => {
      const idx = this.workflows.findIndex((x) => x.id === where.id);
      const [row] = this.workflows.splice(idx, 1);
      this.steps = this.steps.filter((s) => s.workflowId !== where.id); // onDelete: Cascade
      return row;
    },
  };

  stepDefinition = {
    create: async ({ data }: any) => {
      const row = { createdAt: new Date(), nextStepId: null, ...data };
      this.steps.push(row);
      return { ...row };
    },
    deleteMany: async ({ where }: any) => {
      const before = this.steps.length;
      this.steps = this.steps.filter((s) => s.workflowId !== where.workflowId);
      return { count: before - this.steps.length };
    },
  };

  case = {
    count: async ({ where }: any) =>
      this.cases.filter((c) => c.workflowId === where.workflowId).length,
  };

  $transaction = async (fn: (tx: any) => Promise<any>) => fn(this);
}

function sampleDraft(over: Partial<WorkflowDraftDto> = {}): WorkflowDraftDto {
  return {
    id: 'wf-sales-1',
    flowType: FlowType.SALES,
    name: '標準銷售流程',
    description: '§4 銷售流程',
    version: 1,
    isActive: true,
    trigger: { initiatorRole: RoleCode.SALES, condition: '客戶來訪後' },
    calendar: { deferOnHoliday: true, deferStrategy: 'SHIFT_ALL', note: '連假順延' },
    steps: [
      {
        id: 'st-1',
        order: 1,
        name: '建立商機',
        description: '',
        responsibleRole: RoleCode.SALES,
        isOptional: false,
        forms: [{ id: 'f-1', name: '報價單', isRequired: true, isoMapping: 'A.5.1' }],
      },
      {
        id: 'st-2',
        order: 2,
        name: '主管審核',
        description: '金額逾門檻',
        responsibleRole: RoleCode.MANAGER,
        isOptional: true,
        forms: [],
      },
    ],
    updatedAt: '2026-06-10T00:00:00.000Z',
    ...over,
  };
}

function setup() {
  const prisma = new FakePrisma();
  const svc = new WorkflowDefinitionsService(prisma as any);
  return { prisma, svc };
}

describe('WorkflowDefinitionsService', () => {
  it('create→get round-trip 不失真（trigger/calendar/forms/步驟 id 皆保留）', async () => {
    const { svc } = setup();
    const saved = await svc.create(sampleDraft(), 'user-1');
    const fetched = await svc.get('wf-sales-1');
    expect(fetched.id).toBe('wf-sales-1');
    expect(fetched.flowType).toBe(FlowType.SALES);
    expect(fetched.trigger).toEqual(saved.trigger);
    expect(fetched.calendar).toEqual(saved.calendar);
    expect(fetched.steps).toEqual(saved.steps);
    expect(fetched.steps[0].forms[0]).toEqual({
      id: 'f-1',
      name: '報價單',
      isRequired: true,
      isoMapping: 'A.5.1',
    });
  });

  it('再存（update）後內容穩定且步驟全量替換、可由引擎查到正規列', async () => {
    const { svc, prisma } = setup();
    await svc.create(sampleDraft(), 'user-1');
    const fetched = await svc.get('wf-sales-1');
    const again = await svc.update('wf-sales-1', fetched);
    expect(again.steps).toEqual(fetched.steps);
    // 正規 StepDefinition 列與草稿一致（供 createCaseFromWorkflow 使用）
    expect(prisma.steps.map((s) => [s.id, s.order, s.name])).toEqual([
      ['st-1', 1, '建立商機'],
      ['st-2', 2, '主管審核'],
    ]);
    expect(prisma.steps[1].responsibleRoleId).toBe(
      prisma.roles.find((r) => r.code === RoleCode.MANAGER)!.id,
    );
  });

  it('order 亂序輸入會依序重編 1..n（同 web reindex）', async () => {
    const { svc } = setup();
    const draft = sampleDraft();
    draft.steps = [
      { ...draft.steps[1], order: 9 },
      { ...draft.steps[0], order: 3 },
    ];
    const saved = await svc.create(draft, null);
    expect(saved.steps.map((s) => [s.order, s.id])).toEqual([
      [1, 'st-1'],
      [2, 'st-2'],
    ]);
  });

  it('list 回傳摘要（stepCount／updatedAt）', async () => {
    const { svc } = setup();
    await svc.create(sampleDraft(), null);
    const list = await svc.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: 'wf-sales-1',
      name: '標準銷售流程',
      flowType: FlowType.SALES,
      version: 1,
      isActive: true,
      stepCount: 2,
    });
    expect(typeof list[0].updatedAt).toBe('string');
  });

  it('無 designer Json 的既有資料可由正規列重建草稿（設計層欄位給預設值）', async () => {
    const { svc, prisma } = setup();
    prisma.workflows.push({
      id: 'wf-legacy',
      flowType: FlowType.ONBOARDING,
      name: '舊資料',
      description: null,
      version: 1,
      isActive: true,
      designer: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.steps.push({
      id: 'st-x',
      workflowId: 'wf-legacy',
      order: 1,
      name: '啟動',
      description: null,
      responsibleRoleId: prisma.roles.find((r) => r.code === RoleCode.CONSULTANT)!.id,
      isOptional: false,
    });
    const draft = await svc.get('wf-legacy');
    expect(draft.steps).toEqual([
      {
        id: 'st-x',
        order: 1,
        name: '啟動',
        description: '',
        responsibleRole: RoleCode.CONSULTANT,
        isOptional: false,
        forms: [],
      },
    ]);
    expect(draft.trigger).toEqual({ initiatorRole: null, condition: '' });
    expect(draft.calendar.deferStrategy).toBe('NEXT_WORKDAY');
  });

  it('刪除保護：被案件引用 → 停用而非刪除', async () => {
    const { svc, prisma } = setup();
    await svc.create(sampleDraft(), null);
    prisma.cases.push({ id: 'case-1', workflowId: 'wf-sales-1' });
    const res = await svc.remove('wf-sales-1');
    expect(res).toEqual({
      id: 'wf-sales-1',
      deleted: false,
      deactivated: true,
      referencedByCases: 1,
    });
    expect(prisma.workflows[0].isActive).toBe(false);
    expect(prisma.steps).toHaveLength(2); // 步驟保留
  });

  it('無引用 → 實刪且步驟級聯刪除', async () => {
    const { svc, prisma } = setup();
    await svc.create(sampleDraft(), null);
    const res = await svc.remove('wf-sales-1');
    expect(res.deleted).toBe(true);
    expect(prisma.workflows).toHaveLength(0);
    expect(prisma.steps).toHaveLength(0);
  });

  it('get/update/remove 不存在 → NotFoundException', async () => {
    const { svc } = setup();
    await expect(svc.get('nope')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.update('nope', sampleDraft())).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.remove('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('驗證錯誤經 guardEngine 轉 400 {code}', async () => {
    const { svc } = setup();
    const cases: Array<[WorkflowDraftDto, string]> = [
      [sampleDraft({ name: '  ' }), 'invalid_name'],
      [sampleDraft({ flowType: 'NOPE' as FlowType }), 'invalid_flow_type'],
      [
        sampleDraft({
          steps: [
            { ...sampleDraft().steps[0], responsibleRole: 'BOSS' as RoleCode },
          ],
        }),
        'unknown_role',
      ],
      [
        sampleDraft({
          steps: [sampleDraft().steps[0], { ...sampleDraft().steps[1], id: 'st-1' }],
        }),
        'duplicate_step_id',
      ],
      [
        sampleDraft({ steps: [{ ...sampleDraft().steps[0], name: '' }] }),
        'invalid_step_name',
      ],
    ];
    for (const [draft, code] of cases) {
      try {
        await guardEngine(() => svc.create(draft, null));
        fail(`expected ${code}`);
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as BadRequestException).getResponse()).toMatchObject({ code });
      }
    }
  });

  it('同 flowType+name+version 重複建立 → duplicate_workflow_version', async () => {
    const { svc } = setup();
    await svc.create(sampleDraft(), null);
    try {
      await guardEngine(() => svc.create(sampleDraft({ id: 'wf-other' }), null));
      fail('expected duplicate_workflow_version');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toMatchObject({
        code: 'duplicate_workflow_version',
      });
    }
  });
});
