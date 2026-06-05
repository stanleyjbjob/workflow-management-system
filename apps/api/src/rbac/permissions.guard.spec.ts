import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { Permission } from './permissions';

function makeContext(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => 'handler',
    getClass: () => 'class',
  } as unknown as ExecutionContext;
}

function makeReflector(required: Permission[] | undefined): Reflector {
  return { getAllAndOverride: jest.fn().mockReturnValue(required) } as unknown as Reflector;
}

describe('PermissionsGuard', () => {
  it('未標註權限時放行', () => {
    const guard = new PermissionsGuard(makeReflector(undefined));
    expect(guard.canActivate(makeContext({ roles: ['ENGINEER'] }))).toBe(true);
  });

  it('具備所需權限時放行（顧問可 case:assign）', () => {
    const guard = new PermissionsGuard(makeReflector(['case:assign']));
    expect(guard.canActivate(makeContext({ roles: ['CONSULTANT'] }))).toBe(true);
  });

  it('缺少所需權限時擋下（工程師不可 case:assign）', () => {
    const guard = new PermissionsGuard(makeReflector(['case:assign']));
    expect(() => guard.canActivate(makeContext({ roles: ['ENGINEER'] }))).toThrow(
      ForbiddenException,
    );
  });

  it('主管具備全部權限', () => {
    const guard = new PermissionsGuard(makeReflector(['admin:manage', 'audit:read']));
    expect(guard.canActivate(makeContext({ roles: ['MANAGER'] }))).toBe(true);
  });

  it('未登入時擋下 (Unauthorized)', () => {
    const guard = new PermissionsGuard(makeReflector(['case:read']));
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(UnauthorizedException);
  });
});
