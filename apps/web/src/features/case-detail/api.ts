/**
 * 案件詳情/推進 REST 串接（issue 8.12 #47）。
 *
 * 型別鏡像後端 DTO（apps/api/src/cases/cases.service.ts 之 CaseDetailDto 等，
 * 與 8.8 forms/attachments controller 的 body）；日期一律 ISO 字串。
 * 路由：
 * - GET  /cases?flowType=&status=&assigneeId=    案件摘要清單（8.7）
 * - GET  /cases/:id/detail                       案件詳情彙整視圖（8.7）
 * - POST /cases/:id/advance | /cases/:id/return  通用推進/退回（8.7）
 * - POST /forms/submissions、/forms/submissions/:id/approve|reject（8.8）
 * - GET/POST /attachments（8.8；目標三擇一，本頁固定用 caseId）
 * 查詢/酬載組裝為純函式，可被 vitest 直接測試。
 */
import { apiGet, apiPost, buildQuery } from '../../lib/api';

// ---------- 後端 enum 鏡像（apps/api/prisma/schema.prisma） ----------

export type FlowType = 'SALES' | 'ONBOARDING' | 'ENVIRONMENT' | 'CUSTOMIZATION';
export type CaseStatus = 'DRAFT' | 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
export type StepInstanceStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED' | 'RETURNED';
export type SubmissionStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
/** 步驟表單彙整狀態：尚無填寫紀錄為 MISSING。 */
export type StepFormAggregateStatus = SubmissionStatus | 'MISSING';
export type AttachmentType = 'FILE' | 'LINK';
export type SaleMode = 'PURCHASE' | 'SUBSCRIPTION';

// ---------- DTO 鏡像 ----------

export interface UserRef {
  id: string;
  displayName: string;
}

/** GET /cases 清單列。 */
export interface CaseSummary {
  id: string;
  code: string;
  title: string;
  flowType: FlowType;
  status: CaseStatus;
  clientName: string | null;
  saleMode: SaleMode | null;
  assignee: UserRef | null;
  currentStep: {
    stepInstanceId: string;
    name: string;
    order: number;
    assigneeId: string | null;
    dueDate: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

/** 案件詳情：單一步驟應填表單的狀態。 */
export interface CaseStepForm {
  formId: string;
  code: string;
  name: string;
  isRequired: boolean;
  isSignable: boolean;
  status: StepFormAggregateStatus;
  satisfied: boolean;
  submissionId: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
}

/** 案件詳情：步驟列。 */
export interface CaseStep {
  stepInstanceId: string;
  stepDefinitionId: string;
  order: number;
  name: string;
  description: string | null;
  responsibleRoleId: string | null;
  responsibleRoleName: string | null;
  assignee: UserRef | null;
  status: StepInstanceStatus;
  dueDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  note: string | null;
  forms: CaseStepForm[];
}

/** 案件詳情：附件列（案件層＋步驟層＋表單層彙整）。 */
export interface CaseAttachment {
  id: string;
  type: AttachmentType;
  name: string;
  fileUrl: string | null;
  linkUrl: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  version: number;
  stepInstanceId: string | null;
  formSubmissionId: string | null;
  createdAt: string;
}

/** GET /cases/:id/detail 彙整視圖。 */
export interface CaseDetail {
  id: string;
  code: string;
  title: string;
  flowType: FlowType;
  status: CaseStatus;
  clientName: string | null;
  saleMode: SaleMode | null;
  failureReason: string | null;
  workflow: { id: string; name: string; version: number };
  assignee: UserRef | null;
  createdBy: UserRef | null;
  currentStepInstanceId: string | null;
  steps: CaseStep[];
  attachments: CaseAttachment[];
  createdAt: string;
  updatedAt: string;
}

// ---------- 查詢/酬載組裝（純函式） ----------

export interface CaseListFilter {
  flowType?: FlowType | null;
  status?: CaseStatus | null;
  assigneeId?: string | null;
}

/** 組 GET /cases 的 query string。 */
export function caseListQuery(f: CaseListFilter = {}): string {
  return buildQuery({ flowType: f.flowType, status: f.status, assigneeId: f.assigneeId });
}

export interface AdvanceCaseInput {
  note?: string | null;
  assigneeId?: string | null;
}

export interface ReturnCaseInput {
  targetStepDefinitionId: string;
  reason: string;
  assigneeId?: string | null;
}

/** 組 POST /cases/:id/return 的 body（後端要求 targetStepDefinitionId 與非空 reason）。 */
export function returnCaseBody(input: ReturnCaseInput): Record<string, unknown> {
  return {
    targetStepDefinitionId: input.targetStepDefinitionId,
    reason: input.reason,
    ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
  };
}

export interface SubmitFormInput {
  formDefinitionId: string;
  caseId: string;
  stepInstanceId?: string | null;
  data: Record<string, unknown>;
}

export interface AddAttachmentInput {
  caseId: string;
  name: string;
  /** FILE 給 fileUrl、LINK 給 linkUrl（擇一）。 */
  fileUrl?: string | null;
  linkUrl?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
}

// ---------- fetchers ----------

/** 案件摘要清單（後端依登入者可見範圍收斂）。 */
export function fetchCases(f: CaseListFilter = {}): Promise<CaseSummary[]> {
  return apiGet<CaseSummary[]>(`/cases${caseListQuery(f)}`);
}

/** 案件詳情（步驟/表單狀態/附件一次取得）。 */
export function fetchCaseDetail(id: string): Promise<CaseDetail> {
  return apiGet<CaseDetail>(`/cases/${encodeURIComponent(id)}/detail`);
}

/** 通用推進（完成當前步驟並前進；成案/失敗結案等流程專屬動作走各流程 controller）。 */
export function advanceCase(id: string, input: AdvanceCaseInput = {}): Promise<unknown> {
  return apiPost<unknown>(`/cases/${encodeURIComponent(id)}/advance`, input);
}

/** 通用退回（target 必為已走過步驟的 stepDefinitionId，reason 必填）。 */
export function returnCase(id: string, input: ReturnCaseInput): Promise<unknown> {
  return apiPost<unknown>(`/cases/${encodeURIComponent(id)}/return`, returnCaseBody(input));
}

/** 填寫/提交表單（submittedBy＝登入者）。回傳 submission（含 id 供簽核）。 */
export function submitForm(input: SubmitFormInput): Promise<{ id: string }> {
  return apiPost<{ id: string }>(`/forms/submissions`, input);
}

/** 簽核通過。 */
export function approveSubmission(submissionId: string): Promise<unknown> {
  return apiPost<unknown>(`/forms/submissions/${encodeURIComponent(submissionId)}/approve`, {});
}

/** 簽核退回。 */
export function rejectSubmission(submissionId: string): Promise<unknown> {
  return apiPost<unknown>(`/forms/submissions/${encodeURIComponent(submissionId)}/reject`, {});
}

/** 新增附件/連結（掛案件層；SharePoint/OneDrive 連結沿用 M365 權限）。 */
export function addAttachment(input: AddAttachmentInput): Promise<CaseAttachment> {
  return apiPost<CaseAttachment>(`/attachments`, input);
}
