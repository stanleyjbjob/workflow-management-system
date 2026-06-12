/**
 * 案件詳情 呈現對映層（issue 8.12 #47，純函式可測）。
 *
 * 後端 `GET /cases/:id/detail` 回「API 正規化 DTO」；顯示標籤、pill 類別、
 * done/active 判定、可退回步驟等屬前端職責（見 progress-8.7-notes 決策 3），集中於此。
 * pill 類別對應 global.css：p-blue / p-green / p-amber / p-red / p-grey / p-purple。
 */
import type {
  CaseDetail,
  CaseStatus,
  CaseStep,
  CaseStepForm,
  CaseSummary,
  FlowType,
  SaleMode,
  StepFormAggregateStatus,
} from './api';

/** [標籤, pill 類別]。 */
export type Pill = [string, string];

export const FLOW_LABELS: Record<FlowType, string> = {
  SALES: '銷售流程',
  ONBOARDING: '系統導入流程',
  ENVIRONMENT: '環境建置流程',
  CUSTOMIZATION: '客製化流程',
};

export const CASE_STATUS_PILLS: Record<CaseStatus, Pill> = {
  DRAFT: ['草稿', 'p-grey'],
  IN_PROGRESS: ['進行中', 'p-blue'],
  ON_HOLD: ['暫停', 'p-amber'],
  COMPLETED: ['已完成', 'p-green'],
  CANCELLED: ['已取消', 'p-grey'],
  FAILED: ['失敗結案', 'p-red'],
};

export const SALE_MODE_LABELS: Record<SaleMode, string> = {
  PURCHASE: '買斷制',
  SUBSCRIPTION: '訂閱制',
};

export const FORM_STATUS_PILLS: Record<StepFormAggregateStatus, Pill> = {
  MISSING: ['未填寫', 'p-grey'],
  DRAFT: ['草稿', 'p-grey'],
  SUBMITTED: ['已送出', 'p-blue'],
  APPROVED: ['已簽核', 'p-green'],
  REJECTED: ['已退回', 'p-red'],
};

/** 流程顯示名稱。 */
export function flowLabel(flowType: FlowType): string {
  return FLOW_LABELS[flowType] ?? flowType;
}

/** 案件標籤（狀態＋流程；流程用 p-purple 與 prototype 對齊）。 */
export function caseTags(c: Pick<CaseDetail, 'status' | 'flowType' | 'saleMode'>): Pill[] {
  const tags: Pill[] = [CASE_STATUS_PILLS[c.status] ?? [c.status, 'p-grey']];
  tags.push([flowLabel(c.flowType), 'p-purple']);
  if (c.saleMode) tags.push([SALE_MODE_LABELS[c.saleMode] ?? c.saleMode, 'p-grey']);
  return tags;
}

/** 案件副標（客戶 / 案件編號 / 負責人）。 */
export function caseMeta(c: Pick<CaseDetail, 'code' | 'clientName' | 'assignee'>): string {
  const parts: string[] = [`案件編號：${c.code}`];
  if (c.clientName) parts.push(`客戶：${c.clientName}`);
  if (c.assignee) parts.push(`負責人：${c.assignee.displayName}`);
  return parts.join('　·　');
}

/** ISO 字串 → YYYY-MM-DD（無值回 null）。 */
export function dateOnly(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const i = iso.indexOf('T');
  return i > 0 ? iso.slice(0, i) : iso;
}

/** 步驟是否已完成（COMPLETED / SKIPPED 視為已過）。 */
export function stepDone(s: Pick<CaseStep, 'status'>): boolean {
  return s.status === 'COMPLETED' || s.status === 'SKIPPED';
}

/** 步驟是否為當前步驟（以 detail.currentStepInstanceId 為準）。 */
export function stepActive(s: Pick<CaseStep, 'stepInstanceId'>, detail: Pick<CaseDetail, 'currentStepInstanceId'>): boolean {
  return detail.currentStepInstanceId != null && s.stepInstanceId === detail.currentStepInstanceId;
}

/** 步驟狀態 pill。 */
export function stepStatusPill(s: Pick<CaseStep, 'status'>, active: boolean): Pill {
  if (stepDone(s)) return ['已完成', 'p-green'];
  if (s.status === 'RETURNED') return ['被退回', 'p-red'];
  if (active || s.status === 'IN_PROGRESS') return ['進行中', 'p-blue'];
  return ['未開始', 'p-grey'];
}

/** 步驟負責角色顯示（優先角色名，缺者退回角色 ID / 未指定）。 */
export function stepRoleLabel(s: Pick<CaseStep, 'responsibleRoleName' | 'responsibleRoleId'>): string {
  return s.responsibleRoleName ?? s.responsibleRoleId ?? '未指定';
}

/** 當前步驟索引（找不到當前步驟時退回第一個未完成步驟，再退回 0）。 */
export function activeStepIndex(detail: Pick<CaseDetail, 'steps' | 'currentStepInstanceId'>): number {
  const byId = detail.steps.findIndex((s) => stepActive(s, detail));
  if (byId >= 0) return byId;
  const firstOpen = detail.steps.findIndex((s) => !stepDone(s));
  return firstOpen >= 0 ? firstOpen : 0;
}

/** 是否可操作推進（案件進行中且有當前步驟）。權限以後端 403 為準。 */
export function canAdvance(detail: Pick<CaseDetail, 'status' | 'currentStepInstanceId'>): boolean {
  return (detail.status === 'IN_PROGRESS' || detail.status === 'DRAFT') && detail.currentStepInstanceId != null;
}

/** 可退回的目標步驟（當前步驟之前、已走過的步驟；後端以 stepDefinitionId 指定）。 */
export function returnTargets(detail: Pick<CaseDetail, 'steps' | 'currentStepInstanceId'>): CaseStep[] {
  if (detail.currentStepInstanceId == null) return [];
  const idx = detail.steps.findIndex((s) => s.stepInstanceId === detail.currentStepInstanceId);
  if (idx <= 0) return [];
  return detail.steps.slice(0, idx);
}

/** 當前步驟未達成的必填表單名稱（推進按鈕提示用；實際把關在後端）。 */
export function unmetRequiredFormNames(step: Pick<CaseStep, 'forms'>): string[] {
  return step.forms.filter((f) => f.isRequired && !f.satisfied).map((f) => f.name);
}

/** 表單列是否可簽核（可簽核、已有提交且尚未簽核）。 */
export function canSign(f: Pick<CaseStepForm, 'isSignable' | 'submissionId' | 'status'>): boolean {
  return f.isSignable && f.submissionId != null && f.status === 'SUBMITTED';
}

/** 表單列是否可（再）填寫：未簽核完成前皆可重送（後端取最佳狀態彙整）。 */
export function canFill(f: Pick<CaseStepForm, 'status'>): boolean {
  return f.status !== 'APPROVED';
}

/** 附件 meta 顯示字串（版本/大小/時間擇要）。 */
export function attachmentMeta(a: { version: number; sizeBytes: number | null; createdAt: string }): string {
  const parts: string[] = [];
  if (a.version > 1) parts.push(`v${a.version}`);
  if (a.sizeBytes != null) parts.push(formatSize(a.sizeBytes));
  const d = dateOnly(a.createdAt);
  if (d) parts.push(d);
  return parts.join(' · ');
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** 案件清單下拉選項顯示文字。 */
export function caseOptionLabel(c: Pick<CaseSummary, 'code' | 'title' | 'status'>): string {
  const [statusLabel] = CASE_STATUS_PILLS[c.status] ?? [c.status];
  return `${c.code}｜${c.title}（${statusLabel}）`;
}
