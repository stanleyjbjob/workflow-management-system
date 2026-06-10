/** auth/roles 測試（issue 8.5 #40）。 */
import { describe, expect, it } from 'vitest';
import {
  describeRoles,
  hasRole,
  isManager,
  primaryRole,
  roleLabel,
  viewRoleOptions,
} from './roles';

describe('roleLabel', () => {
  it('已知代碼回中文名', () => {
    expect(roleLabel('MANAGER')).toBe('主管');
    expect(roleLabel('ENG_LEAD')).toBe('工程主管');
  });
  it('未知代碼原樣回傳', () => {
    expect(roleLabel('UNKNOWN')).toBe('UNKNOWN');
  });
});

describe('primaryRole', () => {
  it('取第一個角色', () => {
    expect(primaryRole(['SALES', 'MANAGER'])).toBe('SALES');
  });
  it('無角色回 null', () => {
    expect(primaryRole([])).toBeNull();
  });
});

describe('hasRole / isManager', () => {
  it('判斷是否具角色', () => {
    expect(hasRole({ roles: ['SALES'] }, 'SALES')).toBe(true);
    expect(hasRole({ roles: ['SALES'] }, 'MANAGER')).toBe(false);
  });
  it('主管判斷', () => {
    expect(isManager({ roles: ['MANAGER', 'SALES'] })).toBe(true);
    expect(isManager({ roles: ['ENGINEER'] })).toBe(false);
  });
});

describe('describeRoles', () => {
  it('多角色以「、」串接', () => {
    expect(describeRoles(['MANAGER', 'SALES'])).toBe('主管、業務');
  });
  it('無角色回未指派', () => {
    expect(describeRoles([])).toBe('未指派角色');
  });
});

describe('viewRoleOptions', () => {
  it('主管可檢視所有角色', () => {
    expect(viewRoleOptions(['MANAGER'])).toEqual([
      'MANAGER',
      'SALES',
      'CONSULTANT',
      'ENG_LEAD',
      'ENGINEER',
      'ASSISTANT',
    ]);
  });
  it('非主管僅自身角色', () => {
    expect(viewRoleOptions(['SALES'])).toEqual(['SALES']);
    expect(viewRoleOptions(['ENGINEER', 'ASSISTANT'])).toEqual(['ENGINEER', 'ASSISTANT']);
  });
});
