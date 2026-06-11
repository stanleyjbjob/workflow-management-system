/**
 * 專案維護（CRUD / 掛載流程 / 排除日）表單純邏輯（issue 8.10 #45）。
 *
 * 與 board-view / cases 同風格：無 React/DOM 相依，驗證規則**鏡像**後端引擎
 * （project-engine buildProjectDraft / normalizeFlowMount、exclusion-engine、PROJECT_TRANSITIONS），
 * 讓使用者在送出前即得到一致的錯誤提示；後端仍為最終把關（400 {code,message}）。
 */
import type {
  ExclusionDraftPayload,
  ExclusionSourceValue,
  FlowMountPayload,
  FlowTypeValue,
  ProjectDraftPayload,
  ProjectStatusValue,
} from './api';

// ---- 顯示字典 ----

export const PROJECT_STATUS_LABEL: Record<ProjectStatusValue, string> = {
  ACTIVE: '進行中',
  ON_HOLD: '暫停',
  COMPLETED: '已完成',
  CANCELLED: '取消',
};

export const FLOW_TYPE_LABEL: Record<FlowTypeValue, string> = {
  SALES: '銷售',
  ONBOARDING: '系統導入',
  ENVIRONMENT: '環境建置',
  CUSTOMIZATION: '客製化',
};

export const EXCLUSION_SOURCE_LABEL: Record<ExclusionSourceValue, string> = {
  CUSTOMER: '客戶因素',
  INTERNAL: '內部因素',
};

export const FLOW_TYPE_OPTIONS = Object.keys(FLOW_TYPE_LABEL) as FlowTypeValue[];

/**
 * 專案狀態機（鏡像 project-engine PROJECT_TRANSITIONS；§3.1）：
 * ACTIVE ⇄ ON_HOLD，兩者皆可 → COMPLETED / CANCELLED；終態無出邊。
 */
const TRANSITIONS: Record<ProjectStatusValue, ProjectStatusValue[]> = {
  ACTIVE: ['ON_HOLD', 'COMPLETED', 'CANCELLED'],
  ON_HOLD: ['ACTIVE', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

/** 自某狀態可轉入的目標（不含維持原狀）。 */
export function allowedStatusTargets(from: ProjectStatusValue): ProjectStatusValue[] {
  return TRANSITIONS[from] ?? [];
}

// ---- 表單 state 與驗證 ----

export type FormResult<T> = { ok: true; payload: T } | { ok: false; errors: string[] };

/** 專案表單（建立 / 編輯共用；值皆為字串以直接綁 input）。 */
export interface ProjectFormState {
  name: string;
  client: string;
  ownerId: string;
  planStart: string; // YYYY-MM-DD
  planEnd: string;
}

export const EMPTY_PROJECT_FORM: ProjectFormState = { name: '', client: '', ownerId: '', planStart: '', planEnd: '' };

function isValidDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

/** 驗證專案表單（鏡像 buildProjectDraft：全欄位必填、planEnd >= planStart）。 */
export function validateProjectForm(form: ProjectFormState): FormResult<ProjectDraftPayload> {
  const errors: string[] = [];
  const name = form.name.trim();
  const client = form.client.trim();
  const ownerId = form.ownerId.trim();
  if (!name) errors.push('專案名稱必填');
  if (!client) errors.push('客戶名稱必填');
  if (!ownerId) errors.push('負責人（使用者 ID）必填');
  if (!isValidDay(form.planStart)) errors.push('計畫開始日不是合法日期');
  if (!isValidDay(form.planEnd)) errors.push('計畫結束日不是合法日期');
  if (errors.length === 0 && form.planEnd < form.planStart) errors.push('計畫結束日不可早於開始日');
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, payload: { name, client, ownerId, planStart: form.planStart, planEnd: form.planEnd } };
}

/** 掛載流程表單。 */
export interface MountFormState {
  caseId: string;
  flowType: FlowTypeValue | '';
  name: string;
  planStart: string;
  planEnd: string;
  progress: string;
}

export const EMPTY_MOUNT_FORM: MountFormState = {
  caseId: '',
  flowType: '',
  name: '',
  planStart: '',
  planEnd: '',
  progress: '',
};

/**
 * 驗證掛載流程表單（鏡像 normalizeFlowMount）：
 * - 有 caseId 時 flowType / name 可由案件帶出（留空合法）；無 caseId 則兩者必填。
 * - 計畫起迄必填且 end >= start；progress 留空＝0、否則 0..100。
 */
export function validateMountForm(form: MountFormState): FormResult<FlowMountPayload> {
  const errors: string[] = [];
  const caseId = form.caseId.trim();
  const name = form.name.trim();
  if (!caseId) {
    if (!form.flowType) errors.push('未指定案件時，流程型別必填');
    if (!name) errors.push('未指定案件時，流程名稱必填');
  }
  if (!isValidDay(form.planStart)) errors.push('計畫開始日不是合法日期');
  if (!isValidDay(form.planEnd)) errors.push('計畫結束日不是合法日期');
  if (errors.length === 0 && form.planEnd < form.planStart) errors.push('計畫結束日不可早於開始日');
  let progress: number | null = null;
  if (form.progress.trim() !== '') {
    const n = Number(form.progress);
    if (!Number.isFinite(n) || n < 0 || n > 100) errors.push('進度需為 0..100 的數值');
    else progress = Math.round(n);
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    payload: {
      caseId: caseId || null,
      flowType: form.flowType || null,
      name: name || null,
      planStart: form.planStart,
      planEnd: form.planEnd,
      progress,
    },
  };
}

/** 排除日表單。 */
export interface ExclusionFormState {
  fromDate: string;
  toDate: string;
  reason: string;
  source: ExclusionSourceValue | '';
}

export const EMPTY_EXCLUSION_FORM: ExclusionFormState = { fromDate: '', toDate: '', reason: '', source: '' };

/** 驗證排除日表單（鏡像 exclusion-engine：起迄必填且 to >= from、原因必填；source 可空）。 */
export function validateExclusionForm(form: ExclusionFormState): FormResult<ExclusionDraftPayload> {
  const errors: string[] = [];
  if (!isValidDay(form.fromDate)) errors.push('起日不是合法日期');
  if (!isValidDay(form.toDate)) errors.push('迄日不是合法日期');
  if (errors.length === 0 && form.toDate < form.fromDate) errors.push('迄日不可早於起日');
  if (!form.reason.trim()) errors.push('原因必填');
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    payload: {
      fromDate: form.fromDate,
      toDate: form.toDate,
      reason: form.reason.trim(),
      source: form.source || null,
    },
  };
}
