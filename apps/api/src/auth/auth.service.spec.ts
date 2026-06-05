import { ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { verifyToken } from './token.util';

interface MockPrisma {
  role: { findMany: jest.Mock };
  user: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
  userRole: { findMany: jest.Mock; create: jest.Mock; deleteMany: jest.Mock };
  loginAudit: { create: jest.Mock };
}

function makePrisma(): MockPrisma {
  return {
    role: { findMany: jest.fn().mockResolvedValue([{ id: 'rSales' }]) },
    user: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
    },
    userRole: {
      findMany: jest.fn().mockImplementation((args: { select?: unknown }) =>
        args && args.select && (args.select as Record<string, unknown>).role
          ? Promise.resolve([{ role: { code: 'SALES' } }])
          : Promise.resolve([]),
      ),
      create: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({}),
    },
    loginAudit: { create: jest.fn().mockResolvedValue({}) },
  };
}

function makeConfig() {
  return { sessionSecret: 'test-secret', sessionTtlSeconds: 3600 };
}

const profile = { oid: 'oid-1', email: 'sales@contoso.com', displayName: '陳業務' };

function makeEntra() {
  return {
    exchangeCode: jest.fn().mockResolvedValue({ access_token: 'at' }),
    fetchProfile: jest.fn().mockResolvedValue(profile),
    fetchGroupIds: jest.fn().mockResolvedValue(['g-sales']),
  };
}

describe('AuthService', () => {
  it('mapGroupsToRoleIds 依 Role.entraGroupId 對應角色', async () => {
    const prisma = makePrisma();
    const svc = new AuthService(prisma as never, makeEntra() as never, makeConfig() as never);
    const ids = await svc.mapGroupsToRoleIds(['g-sales']);
    expect(ids).toEqual(['rSales']);
    expect(prisma.role.findMany).toHaveBeenCalled();
  });

  it('空群組不查詢直接回空陣列', async () => {
    const prisma = makePrisma();
    const svc = new AuthService(prisma as never, makeEntra() as never, makeConfig() as never);
    const ids = await svc.mapGroupsToRoleIds([]);
    expect(ids).toEqual([]);
    expect(prisma.role.findMany).not.toHaveBeenCalled();
  });

  it('停用帳號 (isActive=false) 應拒絕登入', async () => {
    const prisma = makePrisma();
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', isActive: false, email: profile.email });
    const svc = new AuthService(prisma as never, makeEntra() as never, makeConfig() as never);
    await expect(svc.upsertUserFromProfile(profile, ['g-sales'])).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('handleCallback 成功：新使用者建立、簽發 session、稽核 LOGIN_SUCCESS', async () => {
    const prisma = makePrisma();
    prisma.user.create.mockResolvedValue({
      id: 'u1',
      email: profile.email,
      displayName: profile.displayName,
      entraOid: profile.oid,
      isActive: true,
    });
    const config = makeConfig();
    const svc = new AuthService(prisma as never, makeEntra() as never, config as never);
    const { token, user } = await svc.handleCallback('auth-code', { ip: '1.2.3.4', userAgent: 'jest' });
    expect(user.roles).toEqual(['SALES']);
    const payload = verifyToken<{ sub: string; roles: string[] }>(token, config.sessionSecret);
    expect(payload?.sub).toBe('u1');
    expect(prisma.loginAudit.create).toHaveBeenCalledTimes(1);
    const auditArg = prisma.loginAudit.create.mock.calls[0][0] as { data: { success: boolean } };
    expect(auditArg.data.success).toBe(true);
  });

  it('handleCallback 對停用帳號：拒絕並稽核 LOGIN_FAILURE', async () => {
    const prisma = makePrisma();
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', isActive: false, email: profile.email });
    const svc = new AuthService(prisma as never, makeEntra() as never, makeConfig() as never);
    await expect(svc.handleCallback('auth-code', {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.loginAudit.create).toHaveBeenCalledTimes(1);
    const auditArg = prisma.loginAudit.create.mock.calls[0][0] as {
      data: { success: boolean; reason?: string };
    };
    expect(auditArg.data.success).toBe(false);
    expect(auditArg.data.reason).toBe('account_disabled');
  });
});
