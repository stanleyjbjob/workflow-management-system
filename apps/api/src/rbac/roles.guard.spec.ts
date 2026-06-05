import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function makeContext(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => 'handler',
    getClass: () => 'class',
  } as unknown as ExecutionContext;
}

function makeReflector(required: string[] | undefined): Reflector {
  return { getAllAndOverride: jest.fn().mockReturnValue(required) } as unknown as Reflector;
}

describe('RolesGuard', () => {
  it('未標註角色時放行', () => {
    const guard = new RolesGuard(makeReflector(undefined));
    expect(guard.canActivate(makeContext({ roles: [] }))).toBe(true);
  });

  it('具備所需角色時放行', () => {
    const guard = new RolesGuard(makeReflector(['MANAGER', 'ENG_LEAD']));
    expect(guard.canActivate(makeContext({ roles: ['ENG_LEAD'] }))).toBe(true);
  });

  it('缺少所需角色時擋下 (Forbidden)', () => {
    const guard = new RolesGuard(makeReflector(['MANAGER']));
    expect(() => guard.canActivate(makeContext({ roles: ['ENGINEER'] }))).toThrow(
      ForbiddenException,
    );
  });

  it('未登入 (無 user) 時擋下 (Unauthorized)', () => {
    const guard = new RolesGuard(makeReflector(['MANAGER']));
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(UnauthorizedException);
  });
});
