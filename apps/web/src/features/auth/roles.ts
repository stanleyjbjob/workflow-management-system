/**
 * 角色代碼 ↔ 顯示名稱與檢視過濾邏輯（issue 8.5 #40，純函式可測）。
 *
 * 角色代碼以後端 RBAC 為準（見 docs/DATA_MODEL.md Role）：
 * MANAGER / SALES / CONSULTANT / ENG_LEAD / ENGINEER / ASSISTANT。
 * 真實權限一律以後端為準；前端角色僅作「檢視過濾」。
 */
import type { SessionUser } from './types';

export const MANAGER_ROLE = 'MANAGER';

/** 角色代碼 → 繁體中文顯示名稱（依 docs/DATA_MODEL.md）。 */
export const ROLE_LABELS: Record<string, string> = {
  MANAGER: '主管',
  SALES: '業務',
  CONSULTANT: '顧問',
  ENG_LEAD: '工程主管',
  ENGINEER: '工程師',
  ASSISTANT: '助理',
};

/** 取角色顯示名稱（未知代碼原樣回傳）。 */
export function roleLabel(code: string): string {
  return ROLE_LABELS[code] ?? code;
}

/** 主要角色（取第一個；無角色回 null）。 */
export function primaryRole(roles: readonly string[]): string | null {
  return roles.length > 0 ? roles[0] : null;
}

/** 是否具備某角色。 */
export function hasRole(user: Pick<SessionUser, 'roles'>, code: string): boolean {
  return user.roles.includes(code);
}

/** 是否為主管。 */
export function isManager(user: Pick<SessionUser, 'roles'>): boolean {
  return hasRole(user, MANAGER_ROLE);
}

/** 角色清單顯示字串（label 以「、」串接；無角色回「未指派角色」）。 */
export function describeRoles(roles: readonly string[]): string {
  if (roles.length === 0) return '未指派角色';
  return roles.map(roleLabel).join('、');
}

/**
 * 可選的「檢視角色」清單：
 * - 主管可檢視所有角色視角（協助跨角色稽核）。
 * - 其餘使用者僅能檢視自身角色。
 */
export function viewRoleOptions(roles: readonly string[]): string[] {
  if (roles.includes(MANAGER_ROLE)) return Object.keys(ROLE_LABELS);
  return [...roles];
}
