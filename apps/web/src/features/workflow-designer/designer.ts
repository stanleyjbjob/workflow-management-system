// 流程定義設計器 — 純邏輯（無 React / DOM 相依，可純函式測試）
import type { FlowType, RoleCode } from './constants';
import type {
  CalendarRule,
  StepDraft,
  StepFormRef,
  TriggerRule,
  WorkflowDraft,
} from './types';

// --- 識別碼 ---------------------------------------------------------------
let counter = 0;
export function genId(prefix = 'id'): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${counter}_${rand}`;
}

// --- 建立 -----------------------------------------------------------------
export function emptyTrigger(): TriggerRule {
  return { initiatorRole: null, condition: '' };
}

export function emptyCalendar(): CalendarRule {
  return { deferOnHoliday: true, deferStrategy: 'NEXT_WORKDAY', note: '' };
}

export function createEmptyWorkflow(flowType: FlowType = 'SALES'): WorkflowDraft {
  return {
    id: genId('wf'),
    flowType,
    name: '',
    description: '',
    version: 1,
    isActive: true,
    trigger: emptyTrigger(),
    calendar: emptyCalendar(),
    steps: [],
    updatedAt: new Date().toISOString(),
  };
}

export function createStep(order: number, name = ''): StepDraft {
  return {
    id: genId('step'),
    order,
    name,
    description: '',
    responsibleRole: null,
    isOptional: false,
    forms: [],
  };
}

export function createForm(name = ''): StepFormRef {
  return { id: genId('form'), name, isRequired: true, isoMapping: '' };
}

// --- 步驟維護（皆回傳新陣列，不可變更新）---------------------------------
// 重新編號：依目前陣列順序，order 由 1 連續遞增
export function reindex(steps: StepDraft[]): StepDraft[] {
  return steps.map((s, i) => (s.order === i + 1 ? s : { ...s, order: i + 1 }));
}

export function addStep(steps: StepDraft[], name = ''): StepDraft[] {
  return reindex([...steps, createStep(steps.length + 1, name)]);
}

export function removeStep(steps: StepDraft[], stepId: string): StepDraft[] {
  return reindex(steps.filter((s) => s.id !== stepId));
}

export function moveStep(steps: StepDraft[], stepId: string, dir: -1 | 1): StepDraft[] {
  const idx = steps.findIndex((s) => s.id === stepId);
  if (idx < 0) return steps;
  const target = idx + dir;
  if (target < 0 || target >= steps.length) return steps;
  const next = [...steps];
  const tmp = next[target];
  next[target] = next[idx];
  next[idx] = tmp;
  return reindex(next);
}

export function updateStep(
  steps: StepDraft[],
  stepId: string,
  patch: Partial<Omit<StepDraft, 'id' | 'order'>>,
): StepDraft[] {
  return steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s));
}

// --- 表單維護 -------------------------------------------------------------
export function addForm(steps: StepDraft[], stepId: string, name = ''): StepDraft[] {
  return steps.map((s) =>
    s.id === stepId ? { ...s, forms: [...s.forms, createForm(name)] } : s,
  );
}

export function removeForm(steps: StepDraft[], stepId: string, formId: string): StepDraft[] {
  return steps.map((s) =>
    s.id === stepId ? { ...s, forms: s.forms.filter((f) => f.id !== formId) } : s,
  );
}

export function updateForm(
  steps: StepDraft[],
  stepId: string,
  formId: string,
  patch: Partial<Omit<StepFormRef, 'id'>>,
): StepDraft[] {
  return steps.map((s) =>
    s.id === stepId
      ? { ...s, forms: s.forms.map((f) => (f.id === formId ? { ...f, ...patch } : f)) }
      : s,
  );
}

// --- 下一步推導（對齊流程引擎：以 order 升冪，下一步＝order 較大者之最小）---
export function nextStepOf(steps: StepDraft[], stepId: string): StepDraft | null {
  const ordered = [...steps].sort((a, b) => a.order - b.order);
  const idx = ordered.findIndex((s) => s.id === stepId);
  if (idx < 0 || idx === ordered.length - 1) return null; // 末步 → 流程結束
  return ordered[idx + 1];
}

// --- 驗證 -----------------------------------------------------------------
export interface ValidationResult {
  errors: string[]; // 阻擋儲存
  warnings: string[]; // 提示但可儲存
}

export function validateWorkflow(wf: WorkflowDraft): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!wf.name.trim()) errors.push('流程名稱不可空白。');
  if (wf.version < 1) errors.push('版本需為 1 以上的整數。');
  if (wf.steps.length === 0) errors.push('流程至少需有一個步驟。');

  wf.steps.forEach((s) => {
    if (!s.name.trim()) errors.push(`第 ${s.order} 步：步驟名稱不可空白。`);
    if (!s.responsibleRole) warnings.push(`第 ${s.order} 步：尚未指定負責角色。`);
    s.forms.forEach((f) => {
      if (!f.name.trim()) warnings.push(`第 ${s.order} 步：有未命名的表單 / 產出。`);
    });
  });

  // order 應連續且唯一（reindex 已維持，但仍驗證以防外部資料）
  const orders = wf.steps.map((s) => s.order);
  if (new Set(orders).size !== orders.length) {
    errors.push('步驟順序（order）重複。');
  }

  return { errors, warnings };
}

export function isSavable(wf: WorkflowDraft): boolean {
  return validateWorkflow(wf).errors.length === 0;
}

// 觸碰更新時間（儲存前呼叫）
export function touch(wf: WorkflowDraft): WorkflowDraft {
  return { ...wf, steps: reindex(wf.steps), updatedAt: new Date().toISOString() };
}

// 摘要：可見範圍 / 列表顯示用
export interface WorkflowSummary {
  id: string;
  name: string;
  flowType: FlowType;
  version: number;
  isActive: boolean;
  stepCount: number;
  updatedAt: string;
}

export function summarize(wf: WorkflowDraft): WorkflowSummary {
  return {
    id: wf.id,
    name: wf.name,
    flowType: wf.flowType,
    version: wf.version,
    isActive: wf.isActive,
    stepCount: wf.steps.length,
    updatedAt: wf.updatedAt,
  };
}

export type { RoleCode };
