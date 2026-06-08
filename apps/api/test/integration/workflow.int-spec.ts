import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { WorkflowService } from '../../src/workflow/workflow.service';
import { createTestPrisma, truncateAll } from './setup';

/**
 * 9.1 整合測試：workflow 推進把關（真實 Postgres）。
 *
 * 驗證 WorkflowService 的 DB 相依行為（狀態機落地與回寫）：
 * - createCaseFromWorkflow：依流程定義物化全部步驟實例，第一步直接開工、其餘待命，
 *   case.currentStepInstanceId 指向第一步。
 * - advanceCase：完成目前步驟（COMPLETED + completedAt + note 落地）、下一步轉 IN_PROGRESS，
 *   case.currentStepInstanceId 回寫；走到最後一步則案件 COMPLETED 且 currentStepInstanceId 清空。
 * - returnCase：目前步驟標記 RETURNED 並保留退回原因，重啟較早步驟（支援循環），
 *   目標步驟 completedAt 清空、case 指標回寫。
 * - 守門：無 current step 不可推進；找不到流程/案件丟 NotFound。
 */
describe('WorkflowService (integration / real DB)', () => {
  let prisma: PrismaClient;
  let service: WorkflowService;

  let workflowId: string;
  let step1Id: string;
  let step2Id: string;
  let step3Id: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
    service = new WorkflowService(prisma as PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);

    const workflow = await prisma.workflowDefinition.create({
      data: { flowType: 'SALES', name: '整測-推進流程', version: 1 },
    });
    workflowId = workflow.id;

    // 三步驟：報價 → 簽約 → 交付（皆非選用）。
    const s1 = await prisma.stepDefinition.create({
      data: { workflowId, order: 1, name: '報價' },
    });
    const s2 = await prisma.stepDefinition.create({
      data: { workflowId, order: 2, name: '簽約' },
    });
    const s3 = await prisma.stepDefinition.create({
      data: { workflowId, order: 3, name: '交付' },
    });
    step1Id = s1.id;
    step2Id = s2.id;
    step3Id = s3.id;
  });

  it('建立案件：物化全部步驟，第一步開工、其餘待命，case 指標落地', async () => {
    const assignee = await prisma.user.create({
      data: { email: 'owner@example.com', displayName: '承辦人' },
    });

    const view = await service.createCaseFromWorkflow({
      workflowId,
      title: '推進整測案件',
      assigneeId: assignee.id,
    });

    expect(view.status).toBe('IN_PROGRESS');
    expect(view.steps.map((s) => s.order)).toEqual([1, 2, 3]);
    expect(view.steps.map((s) => s.status)).toEqual([
      'IN_PROGRESS',
      'PENDING',
      'PENDING',
    ]);

    // DB：第一步 startedAt 落地且為案件目前步驟，承辦人僅掛在第一步。
    const caseRow = await prisma.case.findUniqueOrThrow({ where: { id: view.caseId } });
    expect(caseRow.status).toBe('IN_PROGRESS');
    expect(caseRow.currentStepInstanceId).toBe(view.currentStepInstanceId);

    const instances = await prisma.stepInstance.findMany({
      where: { caseId: view.caseId },
      orderBy: { order: 'asc' },
    });
    expect(instances).toHaveLength(3);
    expect(instances[0].startedAt).toBeTruthy();
    expect(instances[0].assigneeId).toBe(assignee.id);
    expect(instances[1].startedAt).toBeNull();
    expect(instances[1].assigneeId).toBeNull();
    expect(view.currentStepDefinitionId).toBe(step1Id);
  });

  it('推進：完成目前步驟（含備註）並開啟下一步，case 指標回寫', async () => {
    const created = await service.createCaseFromWorkflow({
      workflowId,
      title: '推進案件',
    });
    const firstInstanceId = created.currentStepInstanceId as string;

    const nextAssignee = await prisma.user.create({
      data: { email: 'legal@example.com', displayName: '法務' },
    });
    const advanced = await service.advanceCase(created.caseId, {
      note: '報價完成',
      assigneeId: nextAssignee.id,
    });

    // 目前步驟轉到第二步（簽約）。
    expect(advanced.currentStepDefinitionId).toBe(step2Id);
    expect(advanced.status).toBe('IN_PROGRESS');

    const completed = await prisma.stepInstance.findUniqueOrThrow({
      where: { id: firstInstanceId },
    });
    expect(completed.status).toBe('COMPLETED');
    expect(completed.completedAt).toBeTruthy();
    expect(completed.note).toBe('報價完成');

    const next = await prisma.stepInstance.findUniqueOrThrow({
      where: { id: advanced.currentStepInstanceId as string },
    });
    expect(next.status).toBe('IN_PROGRESS');
    expect(next.startedAt).toBeTruthy();
    expect(next.assigneeId).toBe(nextAssignee.id);
  });

  it('推進到最後一步：案件完成，currentStepInstanceId 清空', async () => {
    const created = await service.createCaseFromWorkflow({
      workflowId,
      title: '走完流程',
    });

    await service.advanceCase(created.caseId); // 1 → 2
    await service.advanceCase(created.caseId); // 2 → 3
    const done = await service.advanceCase(created.caseId); // 3 → 完成

    expect(done.status).toBe('COMPLETED');
    expect(done.currentStepInstanceId).toBeNull();

    const caseRow = await prisma.case.findUniqueOrThrow({ where: { id: created.caseId } });
    expect(caseRow.status).toBe('COMPLETED');
    expect(caseRow.currentStepInstanceId).toBeNull();

    const allCompleted = await prisma.stepInstance.findMany({
      where: { caseId: created.caseId },
    });
    expect(allCompleted.every((i) => i.status === 'COMPLETED')).toBe(true);
  });

  it('守門：案件已完成（無 current step）不可再推進', async () => {
    const created = await service.createCaseFromWorkflow({
      workflowId,
      title: '完成後再推進',
    });
    await service.advanceCase(created.caseId);
    await service.advanceCase(created.caseId);
    await service.advanceCase(created.caseId); // 完成

    await expect(service.advanceCase(created.caseId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('退回：目前步驟標記 RETURNED 並保留原因，重啟較早步驟（循環）', async () => {
    const created = await service.createCaseFromWorkflow({
      workflowId,
      title: '退回案件',
    });
    await service.advanceCase(created.caseId); // 1 → 2
    const atStep3 = await service.advanceCase(created.caseId); // 2 → 3
    const step3InstanceId = atStep3.currentStepInstanceId as string;

    const returned = await service.returnCase(created.caseId, step1Id, {
      reason: '交付前發現報價需重議',
    });

    // 案件指標回到第一步。
    expect(returned.currentStepDefinitionId).toBe(step1Id);
    expect(returned.status).toBe('IN_PROGRESS');

    const oldCurrent = await prisma.stepInstance.findUniqueOrThrow({
      where: { id: step3InstanceId },
    });
    expect(oldCurrent.status).toBe('RETURNED');
    expect(oldCurrent.note).toBe('交付前發現報價需重議');

    const target = await prisma.stepInstance.findUniqueOrThrow({
      where: { id: returned.currentStepInstanceId as string },
    });
    expect(target.status).toBe('IN_PROGRESS');
    expect(target.completedAt).toBeNull();
    expect(target.startedAt).toBeTruthy();
  });

  it('守門：找不到流程／案件丟 NotFound', async () => {
    await expect(
      service.createCaseFromWorkflow({ workflowId: 'no-such-workflow', title: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(service.advanceCase('no-such-case')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
