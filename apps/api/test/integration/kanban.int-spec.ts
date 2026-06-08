import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { KanbanService } from '../../src/kanban/kanban.service';
import { AccessScopeService } from '../../src/rbac/access-scope.service';
import { CalendarService } from '../../src/calendar/calendar.service';
import { SessionUser } from '../../src/auth/auth.service';
import { createTestPrisma, truncateAll } from './setup';

/**
 * 9.1 整合測試：kanban getBoard（真實 Postgres）。
 *
 * 驗證 KanbanService 的 DB 相依行為：
 * - 以 AccessScopeService.caseWhere 收斂可見案件範圍（§8.5：主管綜覽全部、非主管僅看
 *   自己經手＋負責流程型別）。
 * - 一張卡＝一筆 StepInstance；COMPLETED 落 DONE 欄、actionable（PENDING/IN_PROGRESS）
 *   依到期狀態落 UPCOMING/IN_PROGRESS/TODO 欄。
 * - 「即將到期」欄同時收納即將到期與逾期；KPI（pending/upcoming/overdue/deferred）統計正確。
 * - 假日 / 連假遞延標示由 CalendarService.loadCalendar（讀 Holiday 表）驅動。
 *
 * 基準時間固定為 2026-06-10（週三，無內建假日），避免 new Date() 造成非決定性。
 */
describe('KanbanService.getBoard (integration / real DB)', () => {
  let prisma: PrismaClient;
  let service: KanbanService;

  // 固定評估基準：2026-06-10（週三）。
  const NOW = new Date('2026-06-10T00:00:00.000Z');
  const DUE_UPCOMING = new Date('2026-06-11T00:00:00.000Z'); // 週四，工作日，視窗內
  const DUE_OVERDUE = new Date('2026-06-08T00:00:00.000Z'); // 週一，早於基準 → 逾期
  const DUE_WEEKEND = new Date('2026-06-13T00:00:00.000Z'); // 週六，非工作日 → 遞延

  // 各案件其 StepInstance id（供分欄斷言）。
  let siA: string; // SALES, IN_PROGRESS, 即將到期, 承辦 sales
  let siB: string; // ONBOARDING, PENDING, 無到期 → TODO
  let siC: string; // SALES, COMPLETED → DONE
  let siD: string; // SALES, IN_PROGRESS, 逾期
  let siE: string; // SALES, PENDING, 週六到期 → 遞延 + 即將到期

  let salesUserId: string;

  const manager: SessionUser = {
    sub: 'mgr-sub',
    email: 'mgr@example.com',
    name: '部門主管',
    roles: ['MANAGER'],
  };
  let sales: SessionUser;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
    service = new KanbanService(
      prisma as PrismaService,
      new AccessScopeService(),
      new CalendarService(prisma as PrismaService),
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);

    const salesUser = await prisma.user.create({
      data: { email: 'sales@example.com', displayName: '業務' },
    });
    const otherUser = await prisma.user.create({
      data: { email: 'other@example.com', displayName: '他人' },
    });
    salesUserId = salesUser.id;
    sales = { sub: salesUser.id, email: salesUser.email, name: '業務', roles: ['SALES'] };

    const roleSales = await prisma.role.create({
      data: { code: 'SALES', name: '業務' },
    });

    // 兩個流程定義（SALES / ONBOARDING）。
    const wfSales = await prisma.workflowDefinition.create({
      data: { flowType: 'SALES', name: '整測-看板SALES', version: 1 },
    });
    const wfOnb = await prisma.workflowDefinition.create({
      data: { flowType: 'ONBOARDING', name: '整測-看板ONB', version: 1 },
    });

    // SALES 步驟（掛負責角色 SALES）與 ONBOARDING 步驟。
    const stepSales = await prisma.stepDefinition.create({
      data: { workflowId: wfSales.id, order: 1, name: '報價', responsibleRoleId: roleSales.id },
    });
    const stepOnb = await prisma.stepDefinition.create({
      data: { workflowId: wfOnb.id, order: 1, name: '導入啟動' },
    });

    // 建案件 + 單一 StepInstance 的小工具。
    let seq = 0;
    const mkCase = async (args: {
      flowType: 'SALES' | 'ONBOARDING';
      stepId: string;
      assigneeId: string;
      createdById?: string;
      status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
      dueDate?: Date | null;
    }): Promise<string> => {
      seq += 1;
      const c = await prisma.case.create({
        data: {
          code: `WMS-K-${seq}`,
          workflowId: args.flowType === 'SALES' ? wfSales.id : wfOnb.id,
          flowType: args.flowType,
          title: `看板整測案件 ${seq}`,
          assigneeId: args.assigneeId,
          createdById: args.createdById ?? args.assigneeId,
          status: args.status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS',
        },
      });
      const si = await prisma.stepInstance.create({
        data: {
          caseId: c.id,
          stepDefinitionId: args.stepId,
          order: 1,
          status: args.status,
          assigneeId: args.assigneeId,
          dueDate: args.dueDate ?? null,
          startedAt: args.status === 'PENDING' ? null : NOW,
          completedAt: args.status === 'COMPLETED' ? NOW : null,
        },
      });
      return si.id;
    };

    siA = await mkCase({ flowType: 'SALES', stepId: stepSales.id, assigneeId: salesUser.id, status: 'IN_PROGRESS', dueDate: DUE_UPCOMING });
    siB = await mkCase({ flowType: 'ONBOARDING', stepId: stepOnb.id, assigneeId: otherUser.id, status: 'PENDING', dueDate: null });
    siC = await mkCase({ flowType: 'SALES', stepId: stepSales.id, assigneeId: otherUser.id, status: 'COMPLETED', dueDate: DUE_OVERDUE });
    siD = await mkCase({ flowType: 'SALES', stepId: stepSales.id, assigneeId: otherUser.id, status: 'IN_PROGRESS', dueDate: DUE_OVERDUE });
    siE = await mkCase({ flowType: 'SALES', stepId: stepSales.id, assigneeId: otherUser.id, status: 'PENDING', dueDate: DUE_WEEKEND });
  });

  /** 攤平看板所有卡片，方便依 stepInstanceId 查找。 */
  function allCards(board: Awaited<ReturnType<KanbanService['getBoard']>>) {
    return Object.values(board.columns).flat();
  }
  function cardOf(board: Awaited<ReturnType<KanbanService['getBoard']>>, id: string) {
    return allCards(board).find((c) => c.stepInstanceId === id);
  }

  it('主管綜覽：看到全部案件，COMPLETED 落 DONE 欄，責任角色落地，KPI 統計正確', async () => {
    const board = await service.getBoard(manager, undefined, { now: NOW });

    // 五張卡全可見（4 actionable + 1 完成）。
    expect(allCards(board)).toHaveLength(5);

    // COMPLETED → DONE 欄。
    expect(board.columns.DONE.map((c) => c.stepInstanceId)).toEqual([siC]);

    // 責任角色由 stepDefinition.responsibleRole 落地。
    expect(cardOf(board, siA)?.responsibleRoleCode).toBe('SALES');

    // KPI：actionable=4（A/B/D/E）、即將到期=2（A/E）、逾期=1（D）、遞延=1（E）。
    expect(board.kpi.pending).toBe(4);
    expect(board.kpi.upcoming).toBe(2);
    expect(board.kpi.overdue).toBe(1);
    expect(board.kpi.deferred).toBe(1);
    expect(board.activeTotal).toBe(4);
  });

  it('即將到期欄同時收納即將到期與逾期；遞延卡片正確標示', async () => {
    const board = await service.getBoard(manager, undefined, { now: NOW });

    const upcomingIds = board.columns.UPCOMING.map((c) => c.stepInstanceId).sort();
    // A（即將到期）、D（逾期）、E（週六到期 → 即將到期）皆落 UPCOMING 欄。
    expect(upcomingIds).toEqual([siA, siD, siE].sort());

    expect(cardOf(board, siD)?.overdue).toBe(true);
    expect(cardOf(board, siA)?.dueSoon).toBe(true);

    const cardE = cardOf(board, siE);
    expect(cardE?.deferred).toBe(true);
    expect(cardE?.deferredDays).toBeGreaterThan(0);

    // 無到期日的 B → TODO 欄。
    expect(board.columns.TODO.map((c) => c.stepInstanceId)).toEqual([siB]);
  });

  it('非主管：可見範圍收斂為自己經手＋負責流程型別（SALES 看不到他人 ONBOARDING 案件）', async () => {
    const board = await service.getBoard(sales, undefined, { now: NOW });

    const ids = allCards(board).map((c) => c.stepInstanceId);
    // 看得到 SALES 流程型別案件（A/C/D/E）。
    expect(ids).toEqual(expect.arrayContaining([siA, siC, siD, siE]));
    // 看不到他人的 ONBOARDING 案件（B）。
    expect(ids).not.toContain(siB);
    expect(cardOf(board, siA)?.assigneeId).toBe(salesUserId);
  });

  it('filter：在可見範圍上再依 flowType 過濾', async () => {
    const board = await service.getBoard(manager, { flowType: 'ONBOARDING' }, { now: NOW });
    expect(allCards(board)).toHaveLength(1);
    expect(allCards(board)[0].stepInstanceId).toBe(siB);
  });
});
