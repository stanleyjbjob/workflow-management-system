import {
  ALL_PERMISSIONS,
  hasAllPermissions,
  hasAnyRole,
  hasPermission,
  isManager,
  permissionsForRoles,
  visibleFlowTypesForRoles,
} from './permissions';

describe('RBAC permissions matrix', () => {
  it('主管擁有全部權限且可見全部流程', () => {
    expect(ALL_PERMISSIONS.every((p) => hasPermission(['MANAGER'], p))).toBe(true);
    expect(isManager(['MANAGER'])).toBe(true);
    expect(visibleFlowTypesForRoles(['MANAGER']).sort()).toEqual(
      ['CUSTOMIZATION', 'ENVIRONMENT', 'ONBOARDING', 'SALES'].sort(),
    );
  });

  it('業務不可簽核、不可管理流程；顧問可簽核', () => {
    expect(hasPermission(['SALES'], 'form:approve')).toBe(false);
    expect(hasPermission(['SALES'], 'workflow:manage')).toBe(false);
    expect(hasPermission(['CONSULTANT'], 'form:approve')).toBe(true);
  });

  it('工程主管可指派、工程師不可指派', () => {
    expect(hasPermission(['ENG_LEAD'], 'case:assign')).toBe(true);
    expect(hasPermission(['ENGINEER'], 'case:assign')).toBe(false);
  });

  it('稽核與管理權限僅主管擁有', () => {
    expect(hasPermission(['MANAGER'], 'audit:read')).toBe(true);
    expect(hasPermission(['MANAGER'], 'admin:manage')).toBe(true);
    expect(hasPermission(['CONSULTANT'], 'audit:read')).toBe(false);
    expect(hasPermission(['ENGINEER'], 'admin:manage')).toBe(false);
  });

  it('助理為唯讀最小集合', () => {
    expect(hasPermission(['ASSISTANT'], 'case:read')).toBe(true);
    expect(hasPermission(['ASSISTANT'], 'case:create')).toBe(false);
  });

  it('可見流程依角色正確', () => {
    expect(visibleFlowTypesForRoles(['SALES'])).toEqual(['SALES']);
    expect(visibleFlowTypesForRoles(['ENGINEER']).sort()).toEqual(
      ['CUSTOMIZATION', 'ENVIRONMENT'].sort(),
    );
  });

  it('多重角色取聯集（權限與可見流程）', () => {
    const roles = ['SALES', 'CONSULTANT'];
    expect(hasPermission(roles, 'form:approve')).toBe(true);
    expect(permissionsForRoles(roles).has('case:create')).toBe(true);
    expect(visibleFlowTypesForRoles(roles).sort()).toEqual(
      ['CUSTOMIZATION', 'ONBOARDING', 'SALES'].sort(),
    );
  });

  it('未知角色被忽略，不授予任何權限', () => {
    expect(permissionsForRoles(['UNKNOWN']).size).toBe(0);
    expect(visibleFlowTypesForRoles(['UNKNOWN'])).toEqual([]);
  });

  it('hasAllPermissions / hasAnyRole 行為', () => {
    expect(hasAllPermissions(['CONSULTANT'], ['case:assign', 'form:approve'])).toBe(true);
    expect(hasAllPermissions(['ENGINEER'], ['case:assign', 'case:read'])).toBe(false);
    expect(hasAllPermissions(['ENGINEER'], [])).toBe(true);
    expect(hasAnyRole(['SALES'], ['MANAGER', 'SALES'])).toBe(true);
    expect(hasAnyRole(['SALES'], ['MANAGER'])).toBe(false);
    expect(hasAnyRole(['SALES'], [])).toBe(true);
  });
});
