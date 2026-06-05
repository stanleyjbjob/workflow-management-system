import { ForbiddenException } from '@nestjs/common';
import { AccessScopeService } from './access-scope.service';
import { SessionUser } from '../auth/auth.service';

function user(sub: string, roles: string[]): SessionUser {
  return { sub, email: `${sub}@contoso.com`, name: sub, roles };
}

describe('AccessScopeService', () => {
  const svc = new AccessScopeService();

  it('主管：caseWhere/projectWhere/workflowWhere 皆為空（綜覽全部）', () => {
    const u = user('mgr', ['MANAGER']);
    expect(svc.caseWhere(u)).toEqual({});
    expect(svc.projectWhere(u)).toEqual({});
    expect(svc.workflowWhere(u)).toEqual({});
  });

  it('業務：caseWhere 含自己經手與 SALES 流程', () => {
    const u = user('u-sales', ['SALES']);
    const where = svc.caseWhere(u) as { OR: Array<Record<string, unknown>> };
    expect(where.OR).toContainEqual({ assigneeId: 'u-sales' });
    expect(where.OR).toContainEqual({ createdById: 'u-sales' });
    expect(where.OR).toContainEqual({ flowType: { in: ['SALES'] } });
  });

  it('業務 workflowWhere 僅限可見流程型別', () => {
    const u = user('u-sales', ['SALES']);
    expect(svc.workflowWhere(u)).toEqual({ flowType: { in: ['SALES'] } });
  });

  it('canViewCase：經手者可見、流程內可見、其餘不可見', () => {
    const u = user('u1', ['ENGINEER']);
    // 流程型別在可見清單（ENVIRONMENT）
    expect(svc.canViewCase(u, { flowType: 'ENVIRONMENT' })).toBe(true);
    // 不在可見流程，但為承辦人
    expect(svc.canViewCase(u, { flowType: 'SALES', assigneeId: 'u1' })).toBe(true);
    // 不在可見流程且非承辦人
    expect(svc.canViewCase(u, { flowType: 'SALES', assigneeId: 'other' })).toBe(false);
  });

  it('assertCanViewCase 不可見時丟出 Forbidden', () => {
    const u = user('u1', ['ENGINEER']);
    expect(() => svc.assertCanViewCase(u, { flowType: 'SALES' })).toThrow(ForbiddenException);
  });

  it('canViewProject：擁有者或建立者可見，其餘不可見', () => {
    const u = user('u1', ['CONSULTANT']);
    expect(svc.canViewProject(u, { ownerId: 'u1' })).toBe(true);
    expect(svc.canViewProject(u, { createdById: 'u1' })).toBe(true);
    expect(svc.canViewProject(u, { ownerId: 'other' })).toBe(false);
    expect(() => svc.assertCanViewProject(u, { ownerId: 'other' })).toThrow(ForbiddenException);
  });

  it('主管 canViewProject 恆可見', () => {
    const u = user('mgr', ['MANAGER']);
    expect(svc.canViewProject(u, { ownerId: 'other' })).toBe(true);
  });
});
