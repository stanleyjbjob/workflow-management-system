import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SessionUser } from '../auth/auth.service';
import { AccessScopeService } from '../rbac/access-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { CaseAccessService } from './case-access.service';

const user: SessionUser = { sub: 'u-1', roles: ['SALES'] } as unknown as SessionUser;

const caseRow = { flowType: 'SALES', assigneeId: 'u-1', createdById: 'u-1' };

function buildPrisma(overrides?: {
  caseRow?: unknown;
  step?: unknown;
  submission?: unknown;
}): PrismaService {
  return {
    case: {
      findUnique: jest
        .fn()
        .mockResolvedValue(overrides && 'caseRow' in overrides ? overrides.caseRow : caseRow),
    },
    stepInstance: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          overrides && 'step' in overrides ? overrides.step : { caseId: 'c-1' },
        ),
    },
    formSubmission: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          overrides && 'submission' in overrides ? overrides.submission : { caseId: 'c-1' },
        ),
    },
  } as unknown as PrismaService;
}

function allowScope(): AccessScopeService {
  return { assertCanViewCase: jest.fn() } as unknown as AccessScopeService;
}

describe('CaseAccessService（issue 8.8 #43）', () => {
  it('caseId 目標：載入案件最小欄位並委派 AccessScopeService', async () => {
    const prisma = buildPrisma();
    const scope = allowScope();
    const svc = new CaseAccessService(prisma, scope);

    await svc.assertCanViewTarget(user, { caseId: 'c-1' });

    expect(prisma.case.findUnique).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      select: { flowType: true, assigneeId: true, createdById: true },
    });
    expect(scope.assertCanViewCase).toHaveBeenCalledWith(user, caseRow);
  });

  it('stepInstanceId 目標：回溯 caseId 再斷言', async () => {
    const prisma = buildPrisma();
    const scope = allowScope();
    const svc = new CaseAccessService(prisma, scope);

    await svc.assertCanViewTarget(user, { stepInstanceId: 'si-1' });

    expect(prisma.stepInstance.findUnique).toHaveBeenCalled();
    expect(scope.assertCanViewCase).toHaveBeenCalledWith(user, caseRow);
  });

  it('formSubmissionId 目標：回溯 caseId 再斷言', async () => {
    const prisma = buildPrisma();
    const scope = allowScope();
    const svc = new CaseAccessService(prisma, scope);

    await svc.assertCanViewTarget(user, { formSubmissionId: 's-1' });

    expect(prisma.formSubmission.findUnique).toHaveBeenCalled();
    expect(scope.assertCanViewCase).toHaveBeenCalledWith(user, caseRow);
  });

  it('未指定目標 → 400 invalid_target', async () => {
    const svc = new CaseAccessService(buildPrisma(), allowScope());
    await expect(svc.assertCanViewTarget(user, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('指定多個目標 → 400 invalid_target', async () => {
    const svc = new CaseAccessService(buildPrisma(), allowScope());
    await expect(
      svc.assertCanViewTarget(user, { caseId: 'c-1', stepInstanceId: 'si-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('案件不存在 → 404 case_not_found', async () => {
    const svc = new CaseAccessService(buildPrisma({ caseRow: null }), allowScope());
    await expect(
      svc.assertCanViewTarget(user, { caseId: 'c-x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('步驟實例不存在 → 404 step_instance_not_found', async () => {
    const svc = new CaseAccessService(buildPrisma({ step: null }), allowScope());
    await expect(
      svc.assertCanViewTarget(user, { stepInstanceId: 'si-x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('提交不存在 → 404 submission_not_found', async () => {
    const svc = new CaseAccessService(buildPrisma({ submission: null }), allowScope());
    await expect(
      svc.assertCanViewTarget(user, { formSubmissionId: 's-x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('AccessScope 斷言失敗 → 403 透傳', async () => {
    const scope = {
      assertCanViewCase: jest.fn(() => {
        throw new ForbiddenException('case_not_visible');
      }),
    } as unknown as AccessScopeService;
    const svc = new CaseAccessService(buildPrisma(), scope);
    await expect(
      svc.assertCanViewTarget(user, { caseId: 'c-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
