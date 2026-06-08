import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { IsoTrailService } from '../../src/iso-trail/iso-trail.service';
import { AccessScopeService } from '../../src/rbac/access-scope.service';
import { SessionUser } from '../../src/auth/auth.service';
import { createTestPrisma, truncateAll } from './setup';

/**
 * 9.1 整合測試：iso-trail getTrail / export（真實 Postgres）。
 *
 * 驗證 IsoTrailService 的 DB 相依行為（§11 文件化軌跡）：
 * - getTrail 跨來源彙整：表單填寫 / 附件 / 登入紀錄 / 專案紀錄（進度 + 排除日）。
 * - 可見範圍（§8.5）：主管綜覽全部；非主管之案件相關（表單 / 附件）以 caseWhere 收斂、
 *   登入紀錄僅限本人、且不含專案層紀錄。
 * - 簽核軌跡落地：APPROVED 視為已簽核（signedOff），SUBMITTED 之 signable 表單為待簽核缺口。
 * - exportAudit / exportCsv：彙總統計、待簽核清單與扁平 CSV 列。
 * - 留存政策（retentionPolicy）可注入並於記錄落地 retentionUntil 與過期統計。
 */
describe('IsoTrailService getTrail/export (integration / real DB)', () => {
  let prisma: PrismaClient;
  let service: IsoTrailService;

  let aliceId: string;
  let bobId: string;
  let approvedSubId: string; // caseSales 上已核可（signedOff）
  let submittedSubId: string; // caseOnb 上待簽核（pending）

  const manager: SessionUser = {
    sub: 'mgr-sub',
    email: 'mgr@example.com',
    name: '部門主管',
    roles: ['MANAGER'],
  };
  let alice: SessionUser; // 非主管（SALES）

  const T0 = new Date('2026-06-01T08:00:00.000Z');
  const T1 = new Date('2026-06-02T09:00:00.000Z');

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
    service = new IsoTrailService(prisma as PrismaService, new AccessScopeService());
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);

    const aliceUser = await prisma.user.create({
      data: { email: 'alice@example.com', displayName: 'Alice' },
    });
    const bobUser = await prisma.user.create({
      data: { email: 'bob@example.com', displayName: 'Bob' },
    });
    aliceId = aliceUser.id;
    bobId = bobUser.id;
    alice = { sub: aliceUser.id, email: aliceUser.email, name: 'Alice', roles: ['SALES'] };

    // 可簽核表單（委任授權書 → DELEGATION_AUTH，requiresSignature）。
    const fd = await prisma.formDefinition.create({
      data: { code: 'DELEG-01', name: '委任授權書', version: 2, isSignable: true },
    });

    const wfSales = await prisma.workflowDefinition.create({
      data: { flowType: 'SALES', name: '整測-ISO-SALES', version: 1 },
    });
    const wfOnb = await prisma.workflowDefinition.create({
      data: { flowType: 'ONBOARDING', name: '整測-ISO-ONB', version: 1 },
    });

    // caseSales：alice 經手（SALES）；caseOnb：bob 經手（ONBOARDING）。
    const caseSales = await prisma.case.create({
      data: {
        code: 'WMS-ISO-1', workflowId: wfSales.id, flowType: 'SALES', title: 'ISO 整測 SALES',
        assigneeId: aliceId, createdById: aliceId,
      },
    });
    const caseOnb = await prisma.case.create({
      data: {
        code: 'WMS-ISO-2', workflowId: wfOnb.id, flowType: 'ONBOARDING', title: 'ISO 整測 ONB',
        assigneeId: bobId, createdById: bobId,
      },
    });

    // 表單填寫：caseSales 上已核可、caseOnb 上待簽核。
    const approved = await prisma.formSubmission.create({
      data: {
        formDefinitionId: fd.id, caseId: caseSales.id, status: 'APPROVED', data: {},
        submittedById: aliceId, submittedAt: T0, approvedById: bobId, approvedAt: T1, createdAt: T0,
      },
    });
    const submitted = await prisma.formSubmission.create({
      data: {
        formDefinitionId: fd.id, caseId: caseOnb.id, status: 'SUBMITTED', data: {},
        submittedById: bobId, submittedAt: T1, createdAt: T0,
      },
    });
    approvedSubId = approved.id;
    submittedSubId = submitted.id;

    // 附件（掛 caseSales）。
    await prisma.attachment.create({
      data: { type: 'FILE', name: '報價單.pdf', caseId: caseSales.id, uploadedById: aliceId, version: 1 },
    });

    // 登入紀錄（alice 與 bob 各一）。
    await prisma.loginAudit.create({
      data: { userId: aliceId, email: alice.email, eventType: 'LOGIN_SUCCESS', success: true },
    });
    await prisma.loginAudit.create({
      data: { userId: bobId, email: 'bob@example.com', eventType: 'LOGIN_SUCCESS', success: true },
    });

    // 專案紀錄（進度 + 排除日）。
    const project = await prisma.project.create({
      data: {
        code: 'PRJ-ISO-1', name: 'ISO 專案', client: '客戶A', ownerId: aliceId, createdById: aliceId,
        planStart: T0, planEnd: T1,
      },
    });
    await prisma.projectFlow.create({
      data: { projectId: project.id, flowType: 'SALES', name: '銷售階段', planStart: T0, planEnd: T1, progress: 50 },
    });
    await prisma.exclusion.create({
      data: { projectId: project.id, fromDate: T0, toDate: T1, reason: '客戶端維護停機' },
    });
  });

  it('主管綜覽：跨來源全彙整（表單×2 + 附件×1 + 登入×2 + 專案×2 = 7），簽核缺口統計正確', async () => {
    const records = await service.getTrail(manager);
    expect(records).toHaveLength(7);

    const byType = records.reduce<Record<string, number>>((acc, r) => {
      acc[r.recordType] = (acc[r.recordType] ?? 0) + 1;
      return acc;
    }, {});
    expect(byType.FORM_SUBMISSION).toBe(2);
    expect(byType.ATTACHMENT).toBe(1);
    expect(byType.LOGIN).toBe(2);

    const summary = await service.getSummary(manager);
    expect(summary.total).toBe(7);
    // 兩張 signable 表單，其中一張已核可、一張待簽核。
    expect(summary.signableCount).toBe(2);
    expect(summary.signedCount).toBe(1);
    expect(summary.pendingSignatureCount).toBe(1);
  });

  it('非主管：案件相關以 caseWhere 收斂、登入僅限本人、不含專案層紀錄', async () => {
    const records = await service.getTrail(alice);

    // alice（SALES）：caseSales 的表單 + 附件可見；caseOnb（他人 ONBOARDING）的表單不可見。
    const formIds = records.filter((r) => r.recordType === 'FORM_SUBMISSION').map((r) => r.recordId);
    expect(formIds).toContain(approvedSubId);
    expect(formIds).not.toContain(submittedSubId);

    // 登入紀錄僅本人。
    const loginActors = records.filter((r) => r.recordType === 'LOGIN').map((r) => r.actorId);
    expect(loginActors).toEqual([aliceId]);

    // 不含專案層紀錄。
    expect(records.some((r) => r.recordType === 'PROJECT_PROGRESS' || r.recordType === 'EXCLUSION')).toBe(false);

    // 合計：1 表單 + 1 附件 + 1 登入 = 3。
    expect(records).toHaveLength(3);
  });

  it('exportAudit / exportCsv：彙總、待簽核清單與扁平 CSV 列', async () => {
    const exp = await service.exportAudit(manager);
    expect(exp.summary.total).toBe(7);
    expect(exp.pendingSignatureIds).toContain(submittedSubId);
    expect(exp.rows).toHaveLength(7);

    const csv = await service.exportCsv(manager);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('recordType');
    expect(lines).toHaveLength(8); // 表頭 + 7 列
    expect(csv).toContain('委任授權書');
  });

  it('留存政策注入：retentionUntil 落地並計入過期統計', async () => {
    const policy = { DELEGATION_AUTH: 1 } as Record<string, number>;
    const records = await service.getTrail(manager, undefined, { retentionPolicy: policy });
    const formRec = records.find((r) => r.recordId === approvedSubId);
    expect(formRec?.retentionUntil).toBeTruthy();

    // 以遠未來為基準 → 已過留存期限者計入。
    const summary = await service.getSummary(manager, undefined, {
      retentionPolicy: policy,
      now: new Date('2030-01-01T00:00:00.000Z'),
    });
    expect(summary.expiredRetentionCount).toBeGreaterThanOrEqual(1);
  });
});
