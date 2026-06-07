/**
 * ISO 27001 文件化軌跡查閱頁型別（需求規格 §11 / issue 8.3 #35）。
 *
 * 為後端 `apps/api/src/iso-trail/iso-trail-engine.ts` 輸出結構的**前端鏡像**
 * （結構複製、與後端型別解耦，與 task-kanban / project-gantt 同風格）。
 * 注意：後端 Date 欄位經 JSON 序列化後為 ISO 字串，故此處以 string 表示。
 */

/** 可稽核紀錄的來源類別（§11.2 對照表的列）。 */
export type TraceRecordType =
  | 'FORM_SUBMISSION'
  | 'ATTACHMENT'
  | 'LOGIN'
  | 'PROJECT_PROGRESS'
  | 'EXCLUSION';

/** ISO 文件種類。 */
export type IsoDocumentKind =
  | 'DELEGATION_AUTH'
  | 'PERSONNEL'
  | 'MEETING_MINUTES'
  | 'TEST_DOC'
  | 'CHANGE_REQUEST'
  | 'ENV_CHECKLIST'
  | 'FAILURE_RECORD'
  | 'WORK_TEMPLATE'
  | 'LOGIN_AUDIT'
  | 'ATTACHMENT'
  | 'PROJECT_RECORD'
  | 'OTHER';

/** 簽核狀態（彙整自送出 / 核可 / 退回時間）。 */
export type TraceSignStatus = 'NONE' | 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

/** 軌跡事件動作。 */
export type TraceAction =
  | 'CREATED'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'UPLOADED'
  | 'LOGIN'
  | 'RECORDED'
  | 'UPDATED';

/** 單一軌跡事件（誰、何時、做了什麼）。 */
export interface TraceEvent {
  action: TraceAction;
  actorId: string | null;
  at: string;
  detail?: string;
}

/** 統一後的「可追溯紀錄」。 */
export interface TraceabilityRecord {
  recordType: TraceRecordType;
  recordId: string;
  title: string;
  documentKind: IsoDocumentKind;
  isoAspect: string;
  annexHint: string | null;
  version: number;
  requiresSignature: boolean;
  signStatus: TraceSignStatus;
  signedOff: boolean;
  events: TraceEvent[];
  occurredAt: string;
  retentionUntil: string | null;
  caseId: string | null;
  projectId: string | null;
  actorId: string | null;
}

/** 彙總統計（GET /iso-trail/summary）。 */
export interface TrailSummary {
  total: number;
  byType: Record<string, number>;
  byAspect: Record<string, number>;
  signableCount: number;
  signedCount: number;
  pendingSignatureCount: number;
  expiredRetentionCount: number;
}

/** 紀錄類別中文標籤。 */
export const RECORD_TYPE_LABELS: Readonly<Record<TraceRecordType, string>> = {
  FORM_SUBMISSION: '表單/產出',
  ATTACHMENT: '附件',
  LOGIN: '登入紀錄',
  PROJECT_PROGRESS: '專案進度',
  EXCLUSION: '排除日',
};

/** 文件種類中文標籤。 */
export const DOCUMENT_KIND_LABELS: Readonly<Record<IsoDocumentKind, string>> = {
  DELEGATION_AUTH: '委任權限表',
  PERSONNEL: '人員資料',
  MEETING_MINUTES: '會議記錄',
  TEST_DOC: '測試文件',
  CHANGE_REQUEST: '需求變更單',
  ENV_CHECKLIST: '環境檢核表',
  FAILURE_RECORD: '失敗/退回紀錄',
  WORK_TEMPLATE: '作業範本',
  LOGIN_AUDIT: '登入稽核',
  ATTACHMENT: '附件',
  PROJECT_RECORD: '專案紀錄',
  OTHER: '其他',
};

/** 軌跡事件動作中文標籤。 */
export const TRACE_ACTION_LABELS: Readonly<Record<TraceAction, string>> = {
  CREATED: '建立',
  SUBMITTED: '送出',
  APPROVED: '核可',
  REJECTED: '退回',
  UPLOADED: '上傳',
  LOGIN: '登入',
  RECORDED: '記錄',
  UPDATED: '更新',
};
