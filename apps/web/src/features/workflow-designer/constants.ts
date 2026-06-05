// 流程定義設計器 — 與資料模型對齊的列舉與顯示標籤（對應 apps/api/prisma/schema.prisma）

export type FlowType = 'SALES' | 'ONBOARDING' | 'ENVIRONMENT' | 'CUSTOMIZATION';

export type RoleCode =
  | 'MANAGER'
  | 'SALES'
  | 'CONSULTANT'
  | 'ENG_LEAD'
  | 'ENGINEER'
  | 'ASSISTANT';

export const FLOW_TYPES: ReadonlyArray<{ value: FlowType; label: string }> = [
  { value: 'SALES', label: '銷售流程' },
  { value: 'ONBOARDING', label: '系統導入流程' },
  { value: 'ENVIRONMENT', label: '環境建置流程' },
  { value: 'CUSTOMIZATION', label: '客製化（需求變更）流程' },
];

export const ROLES: ReadonlyArray<{ value: RoleCode; label: string }> = [
  { value: 'MANAGER', label: '部門主管' },
  { value: 'SALES', label: '業務' },
  { value: 'CONSULTANT', label: '顧問' },
  { value: 'ENG_LEAD', label: '工程主管' },
  { value: 'ENGINEER', label: '工程師' },
  { value: 'ASSISTANT', label: '助理' },
];

export function flowTypeLabel(value: FlowType): string {
  return FLOW_TYPES.find((f) => f.value === value)?.label ?? value;
}

export function roleLabel(value: RoleCode | null | undefined): string {
  if (!value) return '未指定';
  return ROLES.find((r) => r.value === value)?.label ?? value;
}

// 遞延策略：對應需求 §8.3 行事曆整合
export type DeferStrategy = 'NEXT_WORKDAY' | 'SHIFT_ALL';

export const DEFER_STRATEGIES: ReadonlyArray<{ value: DeferStrategy; label: string }> = [
  { value: 'NEXT_WORKDAY', label: '順延至下一個工作日' },
  { value: 'SHIFT_ALL', label: '整體時程後推' },
];
