import { CaseStatus, StepInstanceStatus } from '@prisma/client';

/**
 * 流程引擎核心（純領域邏輯，無 DB 相依）。
 *
 * 對應需求規格 §8.1「流程定義（彈性）」：
 * - 流程由有序步驟組成；每步驟可設負責角色、是否可選、下一步。
 * - 案件依定義逐步推進；步驟完成自動帶出下一步與負責角色。
 * - 支援退回 / 循環（如客製化複測不過退回開發）。
 *
 * 本檔僅負責「決策」：給定步驟定義與案件目前各步驟狀態，
 * 算出「應該怎麼轉換」（advance / return）的計畫（plan）。
 * 真正的資料庫寫入由 WorkflowService 依 plan 執行，使核心可被純函式單元測試覆蓋。
 */

/** 引擎所需的步驟定義最小欄位（對應 Prisma StepDefinition）。 */
export interface EngineStepDefinition {
  id: string;
  order: number;
  name: string;
  responsibleRoleId: string | null;
  isOptional?: boolean;
}

/** 引擎所需的步驟實例最小欄位（對應 Prisma StepInstance）。 */
export interface EngineStepInstance {
  id: string;
  stepDefinitionId: string;
  order: number;
  status: StepInstanceStatus;
}

export type WorkflowEngineErrorCode =
  | 'no_steps'
  | 'duplicate_order'
  | 'current_instance_not_found'
  | 'current_not_active'
  | 'next_instance_missing'
  | 'target_step_not_found'
  | 'invalid_return_target'
  | 'target_instance_missing';

/** 引擎錯誤；以 code 表示原因，方便上層轉成對應 HTTP 例外或訊息。 */
export class WorkflowEngineError extends Error {
  constructor(
    public readonly code: WorkflowEngineErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'WorkflowEngineError';
  }
}

/** 建立案件時要產生的單一步驟實例藍圖。 */
export interface InitialInstanceBlueprint {
  stepDefinitionId: string;
  order: number;
  status: StepInstanceStatus;
  responsibleRoleId: string | null;
}

/** 推進（advance）計畫：完成目前步驟，帶出下一步與負責角色；若無下一步則案件完成。 */
export interface AdvancePlan {
  completedInstanceId: string;
  caseCompleted: boolean;
  nextInstanceId: string | null;
  nextStepDefinitionId: string | null;
  nextResponsibleRoleId: string | null;
  caseStatus: CaseStatus;
}

/** 退回（return）計畫：目前步驟標記退回，重啟某個較早的步驟（支援循環）。 */
export interface ReturnPlan {
  returnedInstanceId: string;
  targetInstanceId: string;
  targetStepDefinitionId: string;
  targetResponsibleRoleId: string | null;
}

/** 依 order 由小到大排序（不改動原陣列）。 */
export function sortByOrder<T extends { order: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order);
}

/**
 * 驗證流程定義是否可用於建立案件。
 * 回傳錯誤代碼陣列（空陣列代表合法）。
 */
export function validateDefinition(
  steps: readonly EngineStepDefinition[],
): WorkflowEngineErrorCode[] {
  const errors: WorkflowEngineErrorCode[] = [];
  if (steps.length === 0) {
    errors.push('no_steps');
    return errors;
  }
  const seen = new Set<number>();
  for (const s of steps) {
    if (seen.has(s.order)) {
      errors.push('duplicate_order');
      break;
    }
    seen.add(s.order);
  }
  return errors;
}

/** 驗證流程定義，不合法則丟出 WorkflowEngineError。 */
export function assertValidDefinition(steps: readonly EngineStepDefinition[]): void {
  const errors = validateDefinition(steps);
  if (errors.length > 0) {
    throw new WorkflowEngineError(errors[0]);
  }
}

/** 取得第一個步驟（order 最小）。空定義則丟出錯誤。 */
export function firstStepDefinition(
  steps: readonly EngineStepDefinition[],
): EngineStepDefinition {
  const sorted = sortByOrder(steps);
  if (sorted.length === 0) throw new WorkflowEngineError('no_steps');
  return sorted[0];
}

/** 取得指定 order 之後的下一個步驟；若已是最後一步回傳 null。 */
export function nextStepDefinition(
  steps: readonly EngineStepDefinition[],
  currentOrder: number,
): EngineStepDefinition | null {
  const sorted = sortByOrder(steps);
  for (const s of sorted) {
    if (s.order > currentOrder) return s;
  }
  return null;
}

/**
 * 建立案件時的步驟實例藍圖：每個步驟一筆。
 * 第一步為 IN_PROGRESS（直接開工），其餘為 PENDING。
 */
export function planInitialInstances(
  steps: readonly EngineStepDefinition[],
): InitialInstanceBlueprint[] {
  assertValidDefinition(steps);
  const sorted = sortByOrder(steps);
  return sorted.map((s, idx) => ({
    stepDefinitionId: s.id,
    order: s.order,
    status: idx === 0 ? StepInstanceStatus.IN_PROGRESS : StepInstanceStatus.PENDING,
    responsibleRoleId: s.responsibleRoleId,
  }));
}

function requireInstance(
  instances: readonly EngineStepInstance[],
  instanceId: string,
): EngineStepInstance {
  const inst = instances.find((i) => i.id === instanceId);
  if (!inst) throw new WorkflowEngineError('current_instance_not_found');
  return inst;
}

function requireStepDef(
  steps: readonly EngineStepDefinition[],
  stepDefinitionId: string,
  code: WorkflowEngineErrorCode,
): EngineStepDefinition {
  const def = steps.find((s) => s.id === stepDefinitionId);
  if (!def) throw new WorkflowEngineError(code);
  return def;
}

/**
 * 計算「完成目前步驟並推進到下一步」的計畫。
 * - 目前步驟實例必須為 IN_PROGRESS。
 * - 找出下一個步驟定義；若無 → 案件完成（COMPLETED）。
 * - 有下一步 → 找出對應的步驟實例（建立案件時已物化），帶出其負責角色。
 */
export function planAdvance(
  steps: readonly EngineStepDefinition[],
  instances: readonly EngineStepInstance[],
  currentInstanceId: string,
): AdvancePlan {
  const current = requireInstance(instances, currentInstanceId);
  if (current.status !== StepInstanceStatus.IN_PROGRESS) {
    throw new WorkflowEngineError('current_not_active');
  }
  const currentDef = requireStepDef(
    steps,
    current.stepDefinitionId,
    'current_instance_not_found',
  );
  const next = nextStepDefinition(steps, currentDef.order);

  if (!next) {
    return {
      completedInstanceId: current.id,
      caseCompleted: true,
      nextInstanceId: null,
      nextStepDefinitionId: null,
      nextResponsibleRoleId: null,
      caseStatus: CaseStatus.COMPLETED,
    };
  }

  const nextInstance = instances.find((i) => i.stepDefinitionId === next.id);
  if (!nextInstance) throw new WorkflowEngineError('next_instance_missing');

  return {
    completedInstanceId: current.id,
    caseCompleted: false,
    nextInstanceId: nextInstance.id,
    nextStepDefinitionId: next.id,
    nextResponsibleRoleId: next.responsibleRoleId,
    caseStatus: CaseStatus.IN_PROGRESS,
  };
}

/**
 * 計算「退回到較早步驟」的計畫（支援循環，如複測不過退回開發）。
 * - 目前步驟實例必須為 IN_PROGRESS。
 * - 目標步驟定義必須存在，且其 order 嚴格小於目前步驟（只能往回退）。
 * - 目標步驟實例（已物化）會被重新啟用為 IN_PROGRESS，目前步驟標記 RETURNED。
 */
export function planReturn(
  steps: readonly EngineStepDefinition[],
  instances: readonly EngineStepInstance[],
  currentInstanceId: string,
  targetStepDefinitionId: string,
): ReturnPlan {
  const current = requireInstance(instances, currentInstanceId);
  if (current.status !== StepInstanceStatus.IN_PROGRESS) {
    throw new WorkflowEngineError('current_not_active');
  }
  const currentDef = requireStepDef(
    steps,
    current.stepDefinitionId,
    'current_instance_not_found',
  );
  const targetDef = requireStepDef(steps, targetStepDefinitionId, 'target_step_not_found');

  if (targetDef.order >= currentDef.order) {
    throw new WorkflowEngineError('invalid_return_target');
  }

  const targetInstance = instances.find((i) => i.stepDefinitionId === targetDef.id);
  if (!targetInstance) throw new WorkflowEngineError('target_instance_missing');

  return {
    returnedInstanceId: current.id,
    targetInstanceId: targetInstance.id,
    targetStepDefinitionId: targetDef.id,
    targetResponsibleRoleId: targetDef.responsibleRoleId,
  };
}
