import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { FormsService } from '../../src/forms';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestPrisma, truncateAll } from './setup';

/**
 * 9.1 整合測試：forms 簽核流程（真實 Postgres）。
 *
 * 驗證 FormsService 的 DB 相依行為：
 * - 表單定義與欄位落地（巢狀 create、欄位排序）。
 * - 送出/簽核/退回 的狀態轉移與「誰於何時」軌跡欄位實際寫入 DB。
 * - 步驟必填表單把關（簽核類需 APPROVED 才齊備）。
 * - 跨步驟引用（前段產出帶往後續步驟）。
 */
describe('FormsService (integration / real DB)', () => {
  let prisma: PrismaClient;
  let service: FormsService;

  // 每個測試重建的共用 fixtures
  let workflowId: string;
  let step1Id: string;
  let step2Id: string;
  let caseId: string;
  let stepInstance1Id: string;
  let stepInstance2Id: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
    // FormsService 僅使用 PrismaService 的 PrismaClient 介面，注入測試連線即可。
    service = new FormsService(prisma as PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);

    const workflow = await prisma.workflowDefinition.create({
      data: { flowType: 'SALES', name: '整測-銷售流程', version: 1 },
    });
    workflowId = workflow.id;

    const step1 = await prisma.stepDefinition.create({
      data: { workflowId, order: 1, name: '報價' },
    });
    const step2 = await prisma.stepDefinition.create({
      data: { workflowId, order: 2, name: '簽約' },
    });
    step1Id = step1.id;
    step2Id = step2.id;

    const c = await prisma.case.create({
      data: {
        code: 'IT-FORMS-0001',
        workflowId,
        flowType: 'SALES',
        title: '整合測試案件',
        status: 'IN_PROGRESS',
      },
    });
    caseId = c.id;

    const si1 = await prisma.stepInstance.create({
      data: { caseId, stepDefinitionId: step1Id, order: 1, status: 'IN_PROGRESS' },
    });
    const si2 = await prisma.stepInstance.create({
      data: { caseId, stepDefinitionId: step2Id, order: 2, status: 'PENDING' },
    });
    stepInstance1Id = si1.id;
    stepInstance2Id = si2.id;
  });

  /** 建立簽核類「報價單」表單（amount 必填數字、note 選填文字）。 */
  async function createQuoteForm() {
    return service.createForm({
      code: 'QUOTE',
      name: '報價單',
      isSignable: true,
      fields: [
        { order: 1, key: 'amount', label: '金額', fieldType: 'NUMBER', required: true },
        { order: 2, key: 'note', label: '備註', fieldType: 'TEXT' },
      ],
    });
  }

  it('建立表單定義：欄位巢狀落地且依 order 排序', async () => {
    const form = await createQuoteForm();
    expect(form.isSignable).toBe(true);
    expect(form.fields.map((f) => f.key)).toEqual(['amount', 'note']);

    const inDb = await prisma.formField.findMany({ where: { formId: form.id } });
    expect(inDb).toHaveLength(2);
  });

  it('送出驗證失敗（缺必填欄位）：丟 400 且不落任何 submission', async () => {
    const form = await createQuoteForm();
    await expect(
      service.submitForm({
        formDefinitionId: form.id,
        caseId,
        stepInstanceId: stepInstance1Id,
        data: { note: '缺 amount' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(await prisma.formSubmission.count()).toBe(0);
  });

  it('簽核流程：送出→核可，狀態與「誰於何時」軌跡實際寫入 DB', async () => {
    const form = await createQuoteForm();
    const submitted = await service.submitForm({
      formDefinitionId: form.id,
      caseId,
      stepInstanceId: stepInstance1Id,
      data: { amount: 100000, note: '首次報價' },
      submittedById: null,
    });
    expect(submitted.status).toBe('SUBMITTED');
    expect(submitted.submittedAt).toBeTruthy();

    const approver = await prisma.user.create({
      data: { email: 'mgr@example.com', displayName: '整測主管' },
    });
    await service.approveSubmission(submitted.id, approver.id);

    const inDb = await prisma.formSubmission.findUniqueOrThrow({
      where: { id: submitted.id },
    });
    expect(inDb.status).toBe('APPROVED');
    expect(inDb.approvedById).toBe(approver.id);
    expect(inDb.approvedAt).toBeTruthy();
  });

  it('退回流程：REJECTED 落地；已定案的 submission 不可再核可', async () => {
    const form = await createQuoteForm();
    const submitted = await service.submitForm({
      formDefinitionId: form.id,
      caseId,
      stepInstanceId: stepInstance1Id,
      data: { amount: 1 },
    });
    const rejected = await service.rejectSubmission(submitted.id, null);
    expect(rejected.status).toBe('REJECTED');

    await expect(service.approveSubmission(submitted.id, null)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.approveSubmission('does-not-exist', null)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('步驟必填把關：簽核類表單需 APPROVED 才齊備（SUBMITTED 不夠）', async () => {
    const form = await createQuoteForm();
    await service.attachFormToStep(step1Id, form.id, true);

    // 尚未填寫 → 未齊備
    let gate = await service.getStepCompletionGate(caseId, step1Id, stepInstance1Id);
    expect(gate.ready).toBe(false);
    expect(gate.unmetFormIds).toEqual([form.id]);

    // 已送出但未核可（簽核類）→ 仍未齊備
    const submitted = await service.submitForm({
      formDefinitionId: form.id,
      caseId,
      stepInstanceId: stepInstance1Id,
      data: { amount: 5000 },
    });
    gate = await service.getStepCompletionGate(caseId, step1Id, stepInstance1Id);
    expect(gate.ready).toBe(false);

    // 核可後 → 齊備可推進
    await service.approveSubmission(submitted.id, null);
    gate = await service.getStepCompletionGate(caseId, step1Id, stepInstance1Id);
    expect(gate.ready).toBe(true);
    expect(gate.unmetFormIds).toEqual([]);
  });

  it('步驟必填把關：非簽核類表單 SUBMITTED 即齊備；他步驟的填寫不可冒用', async () => {
    const plain = await service.createForm({
      code: 'VISIT_LOG',
      name: '拜訪紀錄',
      isSignable: false,
      fields: [{ order: 1, key: 'summary', label: '摘要', fieldType: 'TEXTAREA', required: true }],
    });
    await service.attachFormToStep(step2Id, plain.id, true);

    // 填在 step1 的 instance → step2 仍未齊備（stepInstanceId 必須對應）
    await service.submitForm({
      formDefinitionId: plain.id,
      caseId,
      stepInstanceId: stepInstance1Id,
      data: { summary: '填錯步驟' },
    });
    let gate = await service.getStepCompletionGate(caseId, step2Id, stepInstance2Id);
    expect(gate.ready).toBe(false);

    await service.submitForm({
      formDefinitionId: plain.id,
      caseId,
      stepInstanceId: stepInstance2Id,
      data: { summary: '本步驟填寫' },
    });
    gate = await service.getStepCompletionGate(caseId, step2Id, stepInstance2Id);
    expect(gate.ready).toBe(true);
  });

  it('跨步驟引用：後續步驟帶出前段（較小 order）的最新產出', async () => {
    const form = await createQuoteForm();
    await service.submitForm({
      formDefinitionId: form.id,
      caseId,
      stepInstanceId: stepInstance1Id,
      data: { amount: 88000, note: '定版報價' },
    });

    const { resolved, prefill } = await service.resolveStepReferences(caseId, 2, [
      { sourceFormId: form.id, sourceKey: 'amount', targetKey: 'contractAmount' },
    ]);
    expect(resolved).toHaveLength(1);
    expect(prefill).toEqual({ contractAmount: 88000 });

    // 來源在目前步驟之後（order 2 引用 order 2）→ 不帶出
    const later = await service.resolveStepReferences(caseId, 1, [
      { sourceFormId: form.id, sourceKey: 'amount', targetKey: 'contractAmount' },
    ]);
    expect(later.resolved).toEqual([]);
  });
});
