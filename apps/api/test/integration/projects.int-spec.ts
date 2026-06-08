import { PrismaClient } from '@prisma/client';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ProjectService } from '../../src/projects/project.service';
import { DelayService } from '../../src/projects/delay.service';
import { CalendarService } from '../../src/calendar/calendar.service';
import { AccessScopeService } from '../../src/rbac/access-scope.service';
import { SessionUser } from '../../src/auth/auth.service';
import { createTestPrisma, truncateAll } from './setup';

/**
 * 9.1 整合測試：projects 掛載／進度回寫／延遲計算／可見範圍（真實 Postgres）。
 *
 * 驗證 ProjectService / DelayService / AccessScopeService 的 DB 相依行為：
 * - mountFlow：將既有案件（流程實例）掛載至專案，flowType / 顯示名稱可由案件帶出並落 ProjectFlow（§3.2、§6.1）。
 * - getProjectDetail：每個流程向下展開其案件步驟與負責人（驗收：「可掛載流程並向下查看其步驟與負責人」）。
 * - refreshFlowProgress：依案件步驟完成比例回寫 ProjectFlow.progress（§4.1 預設認定）；
 *   無對應案件之流程保留人工填報值。
 * - mountFlow 把關：flowType 與案件不一致 → 400；案件 / 專案不存在 → 404。
 * - DelayService.getProjectDelaysFresh：先依步驟比例回寫進度再算延遲／超前，狀態與差異天數落地（§4.2–§4.4）。
 * - AccessScopeService.projectWhere：套在真實 prisma.project.findMany 上的可見範圍收斂
 *   （主管綜覽全部；非主管僅自己擁有或建立，§8.5）。
 *
 * 基準時間固定為 2026-06-10（週三，無內建假日），避免 new Date() 造成非決定性。
 */
describe('Projects services (integration / real DB)', () => {
  let prisma: PrismaClient;
  let projects: ProjectService;
  let delays: DelayService;
  const accessScope = new AccessScopeService();

  // 固定評估基準：2026-06-10（週三）。
  const NOW = new Date('2026-06-10T00:00:00.000Z');

  let pmUserId: string; // 專案負責人 / 建立者
  let otherUserId: string; // 他人
  let roleSalesId: string;
  let wfSalesId: string;
  let stepDefIds: string[] = []; // 4 個 SALES 步驟定義（order 1..4）

  const manager: SessionUser = {
    sub: 'mgr-sub',
    email: 'mgr@example.com',
    name: '部門主管',
    roles: ['MANAGER'],
  };
  let pm: SessionUser; // 非主管（PM 角色）

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
    projects = new ProjectService(prisma as PrismaService);
    delays = new DelayService(
      prisma as PrismaService,
      projects,
      new CalendarService(prisma as PrismaService),
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);

    const pmUser = await prisma.user.create({
      data: { email: 'pm@example.com', displayName: '專案經理' },
    });
    const otherUser = await prisma.user.create({
      data: { email: 'other@example.com', displayName: '他人' },
    });
    pmUserId = pmUser.id;
    otherUserId = otherUser.id;
    pm = { sub: pmUser.id, email: pmUser.email, name: '專案經理', roles: ['PM'] };

    const roleSales = await prisma.role.create({ data: { code: 'SALES', name: '業務' } });
    roleSalesId = roleSales.id;

    const wfSales = await prisma.workflowDefinition.create({
      data: { flowType: 'SALES', name: '整測-專案SALES', version: 1 },
    });
    wfSalesId = wfSales.id;

    // 4 個步驟定義（order 1..4），皆掛負責角色 SALES。
    stepDefIds = [];
    for (let order = 1; order <= 4; order++) {
      const sd = await prisma.stepDefinition.create({
        data: { workflowId: wfSales.id, order, name: `SALES步驟${order}`, responsibleRoleId: roleSales.id },
      });
      stepDefIds.push(sd.id);
    }
  });

  /** 建立一個 SALES 案件並物化 4 個 StepInstance；statuses 指定每步狀態。 */
  async function createCaseWithSteps(args: {
    seq: number;
    assigneeId: string;
    createdById?: string;
    statuses: Array<'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED'>;
  }): Promise<string> {
    const c = await prisma.case.create({
      data: {
        code: `WMS-P-${args.seq}`,
        workflowId: wfSalesId,
        flowType: 'SALES',
        title: `專案整測案件 ${args.seq}`,
        assigneeId: args.assigneeId,
        createdById: args.createdById ?? args.assigneeId,
        status: 'IN_PROGRESS',
      },
    });
    for (let i = 0; i < args.statuses.length; i++) {
      const status = args.statuses[i];
      await prisma.stepInstance.create({
        data: {
          caseId: c.id,
          stepDefinitionId: stepDefIds[i],
          order: i + 1,
          status,
          assigneeId: args.assigneeId,
          startedAt: status === 'PENDING' ? null : NOW,
          completedAt: status === 'COMPLETED' ? NOW : null,
        },
      });
    }
    return c.id;
  }

  it('mountFlow：由案件帶出 flowType／名稱並落 ProjectFlow；getProjectDetail 向下展開步驟與負責人', async () => {
    const { id: projectId } = await projects.createProject({
      name: '整測專案A',
      client: '客戶A',
      ownerId: pmUserId,
      planStart: '2026-06-01',
      planEnd: '2026-06-30',
    });

    const caseId = await createCaseWithSteps({
      seq: 1,
      assigneeId: otherUserId,
      statuses: ['COMPLETED', 'IN_PROGRESS', 'PENDING', 'PENDING'],
    });

    // 不指定 flowType / name，應由案件帶出。
    const flow = await projects.mountFlow(projectId, {
      caseId,
      planStart: '2026-06-01',
      planEnd: '2026-06-20',
    });

    const row = await prisma.projectFlow.findUnique({ where: { id: flow.id } });
    expect(row).not.toBeNull();
    expect(row!.flowType).toBe('SALES');
    expect(row!.name).toBe('專案整測案件 1'); // 由 case.title 帶出
    expect(row!.caseId).toBe(caseId);
    expect(row!.progress).toBe(0); // 掛載時不自動回寫，預設 0

    const detail = (await projects.getProjectDetail(projectId)) as any;
    expect(detail.flows).toHaveLength(1);
    const detailFlow = detail.flows[0];
    expect(detailFlow.case.id).toBe(caseId);
    // 向下展開 4 步，order 遞增，帶出步驟名稱與負責角色。
    expect(detailFlow.case.steps.map((s: any) => s.order)).toEqual([1, 2, 3, 4]);
    expect(detailFlow.case.steps[0].stepDefinition.name).toBe('SALES步驟1');
    expect(detailFlow.case.steps[0].stepDefinition.responsibleRole.code).toBe('SALES');
    expect(detailFlow.case.steps[0].assignee.displayName).toBe('他人');
  });

  it('refreshFlowProgress：依步驟完成比例回寫 progress（2/4 COMPLETED → 50）；無案件流程保留人工值', async () => {
    const { id: projectId } = await projects.createProject({
      name: '整測專案B',
      client: '客戶B',
      ownerId: pmUserId,
      planStart: '2026-06-01',
      planEnd: '2026-06-30',
    });

    const caseId = await createCaseWithSteps({
      seq: 2,
      assigneeId: otherUserId,
      statuses: ['COMPLETED', 'COMPLETED', 'IN_PROGRESS', 'PENDING'],
    });
    const mounted = await projects.mountFlow(projectId, {
      caseId,
      planStart: '2026-06-01',
      planEnd: '2026-06-20',
    });

    const refreshed = await projects.refreshFlowProgress(mounted.id);
    expect(refreshed.progress).toBe(50); // 2/4
    const reloaded = await prisma.projectFlow.findUnique({ where: { id: mounted.id }, select: { progress: true } });
    expect(reloaded!.progress).toBe(50); // 已落 DB

    // 無對應案件的手動流程：refresh 不更動其人工填報值。
    const manualFlow = await projects.mountFlow(projectId, {
      flowType: 'SALES',
      name: '人工流程',
      planStart: '2026-06-01',
      planEnd: '2026-06-20',
      progress: 70,
    });
    const manualRefreshed = await projects.refreshFlowProgress(manualFlow.id);
    expect(manualRefreshed.progress).toBe(70);
  });

  it('mountFlow 把關：flowType 與案件不一致 → 400；案件 / 專案不存在 → 404', async () => {
    const { id: projectId } = await projects.createProject({
      name: '整測專案C',
      client: '客戶C',
      ownerId: pmUserId,
      planStart: '2026-06-01',
      planEnd: '2026-06-30',
    });
    const caseId = await createCaseWithSteps({
      seq: 3,
      assigneeId: otherUserId,
      statuses: ['PENDING', 'PENDING', 'PENDING', 'PENDING'],
    });

    // flowType 與案件實際（SALES）不一致 → BadRequest。
    await expect(
      projects.mountFlow(projectId, {
        caseId,
        flowType: 'ONBOARDING',
        planStart: '2026-06-01',
        planEnd: '2026-06-20',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // 案件不存在 → NotFound。
    await expect(
      projects.mountFlow(projectId, {
        caseId: 'non-existent-case',
        planStart: '2026-06-01',
        planEnd: '2026-06-20',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    // 專案不存在 → NotFound。
    await expect(
      projects.mountFlow('non-existent-project', {
        flowType: 'SALES',
        name: 'x',
        planStart: '2026-06-01',
        planEnd: '2026-06-20',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('DelayService.getProjectDelaysFresh：先回寫步驟進度再算延遲，落後狀態與差異天數落地', async () => {
    const { id: projectId } = await projects.createProject({
      name: '整測專案D',
      client: '客戶D',
      ownerId: pmUserId,
      planStart: '2026-06-01',
      planEnd: '2026-06-30',
    });
    // 1/4 完成 → 進度 25；計畫 06-01..06-11，基準 06-10 → 預期 90 → 落後甚多。
    const caseId = await createCaseWithSteps({
      seq: 4,
      assigneeId: otherUserId,
      statuses: ['COMPLETED', 'IN_PROGRESS', 'PENDING', 'PENDING'],
    });
    const mounted = await projects.mountFlow(projectId, {
      caseId,
      planStart: '2026-06-01',
      planEnd: '2026-06-11',
      progress: 0,
    });

    const report = await delays.getProjectDelaysFresh(projectId, { now: NOW });
    expect(report.rows).toHaveLength(1);
    const row = report.rows[0];
    expect(row.id).toBe(mounted.id);
    expect(row.actual).toBe(25); // 由步驟比例回寫
    expect(row.expected).toBe(90); // 9/10 工期
    expect(row.status).toBe('DELAYED');
    expect(row.delayDays).toBeGreaterThan(0);
    expect(report.summary.delayedCount).toBeGreaterThanOrEqual(1);

    // 回寫已落 DB（fresh 會持久化 progress）。
    const reloaded = await prisma.projectFlow.findUnique({ where: { id: mounted.id }, select: { progress: true } });
    expect(reloaded!.progress).toBe(25);
  });

  it('AccessScope.projectWhere：主管綜覽全部；非主管僅自己擁有或建立（套用於真實查詢）', async () => {
    // P1：pm 擁有；P2：pm 建立（他人擁有）；P3：他人擁有且建立。
    const p1 = await prisma.project.create({
      data: { code: 'PRJ-S-1', name: 'P1', client: 'c', ownerId: pmUserId, planStart: NOW, planEnd: NOW, createdById: otherUserId },
    });
    const p2 = await prisma.project.create({
      data: { code: 'PRJ-S-2', name: 'P2', client: 'c', ownerId: otherUserId, planStart: NOW, planEnd: NOW, createdById: pmUserId },
    });
    const p3 = await prisma.project.create({
      data: { code: 'PRJ-S-3', name: 'P3', client: 'c', ownerId: otherUserId, planStart: NOW, planEnd: NOW, createdById: otherUserId },
    });

    // 主管：projectWhere 空 → 全部可見。
    const managerWhere = accessScope.projectWhere(manager);
    const managerRows = await prisma.project.findMany({ where: managerWhere as any, select: { id: true } });
    expect(managerRows.map((r) => r.id).sort()).toEqual([p1.id, p2.id, p3.id].sort());

    // 非主管（pm）：僅 owner 或 createdBy 為自己 → P1 + P2，不含 P3。
    const pmWhere = accessScope.projectWhere(pm);
    const pmRows = await prisma.project.findMany({ where: pmWhere as any, select: { id: true } });
    const pmIds = pmRows.map((r) => r.id).sort();
    expect(pmIds).toEqual([p1.id, p2.id].sort());
    expect(pmIds).not.toContain(p3.id);
  });
});
