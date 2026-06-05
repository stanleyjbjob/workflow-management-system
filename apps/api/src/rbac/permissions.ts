import { FlowType, RoleCode } from '@prisma/client';

/**
 * 系統權限（resource:action）。粒度刻意保持中等，供各功能模組於後續 WBS 階段引用。
 * 真正的端點會以 @Permissions(...) 標註所需權限，再由 PermissionsGuard 驗證。
 */
export type Permission =
  | 'workflow:read'
  | 'workflow:manage'
  | 'form:read'
  | 'form:fill'
  | 'form:approve'
  | 'form:manage'
  | 'case:read'
  | 'case:create'
  | 'case:update'
  | 'case:advance'
  | 'case:assign'
  | 'attachment:read'
  | 'attachment:upload'
  | 'project:read'
  | 'project:create'
  | 'project:update'
  | 'project:manage'
  | 'audit:read'
  | 'admin:manage';

/** 所有權限（部門主管擁有全部）。 */
export const ALL_PERMISSIONS: Permission[] = [
  'workflow:read',
  'workflow:manage',
  'form:read',
  'form:fill',
  'form:approve',
  'form:manage',
  'case:read',
  'case:create',
  'case:update',
  'case:advance',
  'case:assign',
  'attachment:read',
  'attachment:upload',
  'project:read',
  'project:create',
  'project:update',
  'project:manage',
  'audit:read',
  'admin:manage',
];

/**
 * 角色 → 權限矩陣（資料驅動，可日後改由 DB 設定）。
 * 對應需求規格 §2 角色職責與 §8.5 權限與綜覽：
 * - MANAGER（部門主管）：流程設計者與最終審核者，綜覽全部 → 全權限。
 * - SALES（業務）：發起銷售流程、填表、上傳附件、建立/推進案件與專案。
 * - CONSULTANT（顧問）：導入與客製化負責人，可簽核（複測/委任權限表）、指派工程主管。
 * - ENG_LEAD（工程主管）：分派工程師（case:assign）、推進建置/客製案件。
 * - ENGINEER（工程師）：執行建置與開發、填寫測試文件、推進案件。
 * - ASSISTANT（助理，暫不納入）：唯讀最小集合，預留未來擴充。
 */
export const ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  MANAGER: [...ALL_PERMISSIONS],
  SALES: [
    'workflow:read',
    'form:read',
    'form:fill',
    'case:read',
    'case:create',
    'case:update',
    'case:advance',
    'attachment:read',
    'attachment:upload',
    'project:read',
    'project:create',
    'project:update',
  ],
  CONSULTANT: [
    'workflow:read',
    'form:read',
    'form:fill',
    'form:approve',
    'case:read',
    'case:create',
    'case:update',
    'case:advance',
    'case:assign',
    'attachment:read',
    'attachment:upload',
    'project:read',
    'project:create',
    'project:update',
  ],
  ENG_LEAD: [
    'workflow:read',
    'form:read',
    'form:fill',
    'case:read',
    'case:update',
    'case:advance',
    'case:assign',
    'attachment:read',
    'attachment:upload',
    'project:read',
  ],
  ENGINEER: [
    'workflow:read',
    'form:read',
    'form:fill',
    'case:read',
    'case:update',
    'case:advance',
    'attachment:read',
    'attachment:upload',
    'project:read',
  ],
  ASSISTANT: ['workflow:read', 'form:read', 'case:read', 'attachment:read'],
};

/**
 * 角色 → 可見流程型別。決定使用者預設可見哪些流程/案件（除自己經手者外）。
 * 主管可見全部。對應 §3 四大流程的角色定位。
 */
export const FLOW_VISIBILITY: Record<RoleCode, FlowType[]> = {
  MANAGER: ['SALES', 'ONBOARDING', 'ENVIRONMENT', 'CUSTOMIZATION'],
  SALES: ['SALES'],
  CONSULTANT: ['ONBOARDING', 'CUSTOMIZATION'],
  ENG_LEAD: ['ENVIRONMENT', 'CUSTOMIZATION'],
  ENGINEER: ['ENVIRONMENT', 'CUSTOMIZATION'],
  ASSISTANT: [],
};

function asRoleCode(role: string): RoleCode | undefined {
  return (ROLE_PERMISSIONS as Record<string, Permission[]>)[role] ? (role as RoleCode) : undefined;
}

/** 是否具部門主管角色（綜覽全部）。 */
export function isManager(roles: readonly string[]): boolean {
  return roles.includes('MANAGER');
}

/** 由角色集合展開為權限集合（聯集）。 */
export function permissionsForRoles(roles: readonly string[]): Set<Permission> {
  const set = new Set<Permission>();
  for (const role of roles) {
    const code = asRoleCode(role);
    if (!code) continue;
    for (const p of ROLE_PERMISSIONS[code]) set.add(p);
  }
  return set;
}

/** 角色集合是否具備指定權限。 */
export function hasPermission(roles: readonly string[], permission: Permission): boolean {
  return permissionsForRoles(roles).has(permission);
}

/** 角色集合是否具備全部指定權限。 */
export function hasAllPermissions(
  roles: readonly string[],
  permissions: readonly Permission[],
): boolean {
  if (permissions.length === 0) return true;
  const owned = permissionsForRoles(roles);
  return permissions.every((p) => owned.has(p));
}

/** 角色集合是否至少具備其中一個指定角色。 */
export function hasAnyRole(roles: readonly string[], required: readonly string[]): boolean {
  if (required.length === 0) return true;
  return roles.some((r) => required.includes(r));
}

/** 角色集合的可見流程型別（聯集；主管為全部）。 */
export function visibleFlowTypesForRoles(roles: readonly string[]): FlowType[] {
  if (isManager(roles)) return [...FLOW_VISIBILITY.MANAGER];
  const set = new Set<FlowType>();
  for (const role of roles) {
    const code = asRoleCode(role);
    if (!code) continue;
    for (const f of FLOW_VISIBILITY[code]) set.add(f);
  }
  return [...set];
}
