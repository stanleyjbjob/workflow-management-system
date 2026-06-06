/**
 * ISO 27001 文件化軌跡引擎核心（純領域邏輯，無 DB / Nest / Prisma 相依）。
 *
 * 對應需求規格 §11「ISO 27001 文件化需求對應框架」與 issue 6.2：
 * - 將系統內各類「可稽核產物」（表單/產出含簽核、附件、登入紀錄、專案進度/排除日）
 *   統一收斂為一種「可追溯紀錄（TraceabilityRecord）」，提供：
 *     1) 版本控管（version）
 *     2) 簽核軌跡（signing trail：誰於何時送出/核可/退回）
 *     3) 留存期限（retentionUntil，依可設定政策推導）
 *     4) 可追溯性（events：誰、何時、做了什麼；caseId/projectId 關聯）
 * - 提供 §11.2 對照表的「文件種類 → ISO 面向」對映（預設沿用規格初版，可由呼叫端覆寫）。
 * - 提供稽核紀錄查閱（filter/summary）與匯出（扁平列 + CSV 序列化）。
 *
 * 設計原則（沿用 2.x~6.1 純引擎風格）：
 * - 與 Prisma 解耦：引擎以「結構型別」接收輸入（不 import @prisma/client），由服務層負責 map。
 * - 日界一律以 UTC 判斷，測試可穩定重現。
 * - 不臆測業務規則：留存期限預設為「未定（null）」，唯有呼叫端提供政策時才推導日期；
 *   §11.3 待釐清（現行 ISO 文件清單 / Annex A 對應 / 留存期限 / 簽核層級）由主管定案後注入即生效。
 */

// 型別

/** 可稽核紀錄的來源類別（對應 §11.2 對照表的列）。 */
export type TraceRecordType =
  | 'FORM_SUBMISSION'
  | 'ATTACHMENT'
  | 'LOGIN'
  | 'PROJECT_PROGRESS'
  | 'EXCLUSION';

/** ISO 文件種類（用於對應 ISO 面向與留存政策；預設依 §11.2，可由呼叫端覆寫）。 */
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

/** 軌跡事件動作（誰、何時、做了什麼之「做了什麼」）。 */
export type TraceAction =
  | 'CREATED'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'UPLOADED'
  | 'LOGIN'
  | 'RECORDED'
  | 'UPDATED';

/** 單一軌跡事件。 */
export interface TraceEvent {
  action: TraceAction;
  actorId: string | null;
  at: Date;
  detail?: string;
}

/** ISO 面向對映項。 */
export interface IsoAspectMapping {
  aspect: string;
  annexHint: string | null;
  requiresSignature: boolean;
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
  occurredAt: Date;
  retentionUntil: Date | null;
  caseId: string | null;
  projectId: string | null;
  actorId: string | null;
}

/** 引擎錯誤碼。 */
export type IsoTrailErrorCode = 'invalid_date';

export class IsoTrailEngineError extends Error {
  constructor(public readonly code: IsoTrailErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'IsoTrailEngineError';
  }
}

// 預設對照（§11.2，可覆寫）

/** §11.2 對照表初版：文件種類 → ISO 面向 / 是否需簽核。 */
export const DEFAULT_ISO_ASPECT_MAP: Record<IsoDocumentKind, IsoAspectMapping> = {
  DELEGATION_AUTH: { aspect: '存取控制、權限授予紀錄', annexHint: null, requiresSignature: true },
  PERSONNEL: { aspect: '個資 / 資產盤點相關', annexHint: null, requiresSignature: false },
  MEETING_MINUTES: { aspect: '溝通與決策紀錄', annexHint: null, requiresSignature: false },
  TEST_DOC: { aspect: '變更管理、測試紀錄', annexHint: null, requiresSignature: false },
  CHANGE_REQUEST: { aspect: '變更管理流程', annexHint: null, requiresSignature: true },
  ENV_CHECKLIST: { aspect: '營運安全、組態管理', annexHint: null, requiresSignature: false },
  FAILURE_RECORD: { aspect: '改善 / 矯正措施', annexHint: null, requiresSignature: false },
  WORK_TEMPLATE: { aspect: '文件化資訊管制', annexHint: null, requiresSignature: false },
  LOGIN_AUDIT: { aspect: 'A.5 存取控制 / 稽核軌跡', annexHint: 'A.5', requiresSignature: false },
  ATTACHMENT: { aspect: '流程紀錄佐證、文件版本控管', annexHint: null, requiresSignature: false },
  PROJECT_RECORD: { aspect: '營運規劃與管控', annexHint: null, requiresSignature: false },
  OTHER: { aspect: '未分類', annexHint: null, requiresSignature: false },
};

/**
 * 表單代碼 → 文件種類的預設啟發式對照（以代碼 / 名稱關鍵字判斷）。
 * 注意：此為暫定對照，真實對應待 §11.3 主管提供現行 ISO 文件清單後校正；可由呼叫端整批覆寫。
 */
export interface FormKindPattern {
  kind: IsoDocumentKind;
  keywords: string[];
}

export const DEFAULT_FORM_KIND_PATTERNS: FormKindPattern[] = [
  { kind: 'DELEGATION_AUTH', keywords: ['委任', 'delegation', 'authorization'] },
  { kind: 'PERSONNEL', keywords: ['人員', 'personnel', 'staff'] },
  { kind: 'CHANGE_REQUEST', keywords: ['需求變更', 'change', 'change_request'] },
  { kind: 'TEST_DOC', keywords: ['測試', '複測', 'test', 'retest'] },
  { kind: 'ENV_CHECKLIST', keywords: ['環境', '驗收', 'environment', 'acceptance', 'checklist'] },
  { kind: 'MEETING_MINUTES', keywords: ['會議', '啟動', 'meeting', 'kickoff', 'minutes'] },
  { kind: 'FAILURE_RECORD', keywords: ['失敗', '退回', 'failure', 'reject', 'return'] },
  { kind: 'WORK_TEMPLATE', keywords: ['範本', 'template', 'SOP'] },
];

/** 留存政策：文件種類 → 留存年數（null = 永久 / 未定）。 */
export type IsoRetentionPolicy = Partial<Record<IsoDocumentKind, number | null>>;

/**
 * 範例留存政策（僅供示範與測試；非系統預設）。
 * 實際留存期限待 §11.3 依現行 ISO 程序書定義後注入。
 */
export const SAMPLE_RETENTION_POLICY: IsoRetentionPolicy = {
  DELEGATION_AUTH: 7,
  CHANGE_REQUEST: 5,
  TEST_DOC: 5,
  ENV_CHECKLIST: 5,
  MEETING_MINUTES: 3,
  PERSONNEL: 3,
  FAILURE_RECORD: 3,
  WORK_TEMPLATE: null,
  LOGIN_AUDIT: 1,
  ATTACHMENT: 3,
  PROJECT_RECORD: 3,
  OTHER: 3,
};

// 工具

function assertDate(d: Date | undefined | null, label: string): Date {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new IsoTrailEngineError('invalid_date', label + ': invalid_date');
  }
  return d;
}

/** UTC ISO 日期（YYYY-MM-DD）。 */
export function toIsoDate(d: Date): string {
  const x = assertDate(d, 'toIsoDate');
  const y = x.getUTCFullYear();
  const m = String(x.getUTCMonth() + 1).padStart(2, '0');
  const day = String(x.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function includesCi(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

// 分類與對應

export function classifyFormByCode(
  code: string,
  name = '',
  patterns: readonly FormKindPattern[] = DEFAULT_FORM_KIND_PATTERNS,
): IsoDocumentKind {
  const hay = code + ' ' + name;
  for (const p of patterns) {
    if (p.keywords.some((k) => includesCi(hay, k))) return p.kind;
  }
  return 'OTHER';
}

export function resolveAspect(
  kind: IsoDocumentKind,
  map: Record<IsoDocumentKind, IsoAspectMapping> = DEFAULT_ISO_ASPECT_MAP,
): IsoAspectMapping {
  return map[kind] ?? map.OTHER;
}

export function computeRetentionUntil(
  occurredAt: Date,
  kind: IsoDocumentKind,
  policy?: IsoRetentionPolicy,
): Date | null {
  assertDate(occurredAt, 'computeRetentionUntil');
  if (!policy) return null;
  if (!(kind in policy)) return null;
  const years = policy[kind];
  if (years == null) return null;
  const out = new Date(occurredAt.getTime());
  out.setUTCFullYear(out.getUTCFullYear() + years);
  return out;
}

export function isRetentionExpired(record: TraceabilityRecord, now: Date): boolean {
  assertDate(now, 'isRetentionExpired');
  if (record.retentionUntil == null) return false;
  return now.getTime() > record.retentionUntil.getTime();
}

// 簽核軌跡

export interface FormSubmissionTraceInput {
  id: string;
  formCode: string;
  formName: string;
  version: number;
  isSignable: boolean;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  createdAt: Date;
  submittedById?: string | null;
  submittedAt?: Date | null;
  approvedById?: string | null;
  approvedAt?: Date | null;
  caseId?: string | null;
  documentKind?: IsoDocumentKind;
}

export function buildSigningTrail(sub: FormSubmissionTraceInput): TraceEvent[] {
  const events: TraceEvent[] = [];
  events.push({ action: 'CREATED', actorId: sub.submittedById ?? null, at: assertDate(sub.createdAt, 'createdAt') });
  if (sub.submittedAt) {
    events.push({ action: 'SUBMITTED', actorId: sub.submittedById ?? null, at: assertDate(sub.submittedAt, 'submittedAt') });
  }
  if (sub.approvedAt && (sub.status === 'APPROVED' || sub.status === 'REJECTED')) {
    events.push({
      action: sub.status === 'APPROVED' ? 'APPROVED' : 'REJECTED',
      actorId: sub.approvedById ?? null,
      at: assertDate(sub.approvedAt, 'approvedAt'),
    });
  }
  return sortEvents(events);
}

export function signStatusOf(sub: FormSubmissionTraceInput): TraceSignStatus {
  switch (sub.status) {
    case 'DRAFT':
      return 'DRAFT';
    case 'SUBMITTED':
      return 'SUBMITTED';
    case 'APPROVED':
      return 'APPROVED';
    case 'REJECTED':
      return 'REJECTED';
    default:
      return 'NONE';
  }
}

function sortEvents(events: TraceEvent[]): TraceEvent[] {
  return [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
}

function latestAt(events: readonly TraceEvent[], fallback: Date): Date {
  if (events.length === 0) return fallback;
  return events.reduce((max, e) => (e.at.getTime() > max.getTime() ? e.at : max), events[0].at);
}

// 各來源 → 紀錄

export interface BuildRecordOptions {
  aspectMap?: Record<IsoDocumentKind, IsoAspectMapping>;
  formPatterns?: readonly FormKindPattern[];
  retentionPolicy?: IsoRetentionPolicy;
}

export function formSubmissionToRecord(
  sub: FormSubmissionTraceInput,
  opts: BuildRecordOptions = {},
): TraceabilityRecord {
  const kind = sub.documentKind ?? classifyFormByCode(sub.formCode, sub.formName, opts.formPatterns);
  const mapping = resolveAspect(kind, opts.aspectMap);
  const events = buildSigningTrail(sub);
  const occurredAt = latestAt(events, sub.createdAt);
  const status = signStatusOf(sub);
  const requiresSignature = sub.isSignable || mapping.requiresSignature;
  return {
    recordType: 'FORM_SUBMISSION',
    recordId: sub.id,
    title: sub.formName || sub.formCode,
    documentKind: kind,
    isoAspect: mapping.aspect,
    annexHint: mapping.annexHint,
    version: sub.version,
    requiresSignature,
    signStatus: status,
    signedOff: status === 'APPROVED',
    events,
    occurredAt,
    retentionUntil: computeRetentionUntil(occurredAt, kind, opts.retentionPolicy),
    caseId: sub.caseId ?? null,
    projectId: null,
    actorId: sub.submittedById ?? sub.approvedById ?? null,
  };
}

export interface AttachmentTraceInput {
  id: string;
  name: string;
  type: 'FILE' | 'LINK';
  version: number;
  uploadedById?: string | null;
  createdAt: Date;
  caseId?: string | null;
}

export function attachmentToRecord(
  att: AttachmentTraceInput,
  opts: BuildRecordOptions = {},
): TraceabilityRecord {
  const kind: IsoDocumentKind = 'ATTACHMENT';
  const mapping = resolveAspect(kind, opts.aspectMap);
  const occurredAt = assertDate(att.createdAt, 'attachment.createdAt');
  const events: TraceEvent[] = [
    { action: 'UPLOADED', actorId: att.uploadedById ?? null, at: occurredAt, detail: att.type },
  ];
  return {
    recordType: 'ATTACHMENT',
    recordId: att.id,
    title: att.name,
    documentKind: kind,
    isoAspect: mapping.aspect,
    annexHint: mapping.annexHint,
    version: att.version,
    requiresSignature: mapping.requiresSignature,
    signStatus: 'NONE',
    signedOff: false,
    events,
    occurredAt,
    retentionUntil: computeRetentionUntil(occurredAt, kind, opts.retentionPolicy),
    caseId: att.caseId ?? null,
    projectId: null,
    actorId: att.uploadedById ?? null,
  };
}

export interface LoginTraceInput {
  id: string;
  userId?: string | null;
  email?: string | null;
  eventType: 'LOGIN_SUCCESS' | 'LOGIN_FAILURE' | 'LOGOUT';
  success: boolean;
  at: Date;
  reason?: string | null;
}

export function loginToRecord(
  log: LoginTraceInput,
  opts: BuildRecordOptions = {},
): TraceabilityRecord {
  const kind: IsoDocumentKind = 'LOGIN_AUDIT';
  const mapping = resolveAspect(kind, opts.aspectMap);
  const occurredAt = assertDate(log.at, 'login.at');
  const title = log.eventType + (log.email ? ' (' + log.email + ')' : '');
  const events: TraceEvent[] = [
    { action: 'LOGIN', actorId: log.userId ?? null, at: occurredAt, detail: log.reason ?? log.eventType },
  ];
  return {
    recordType: 'LOGIN',
    recordId: log.id,
    title,
    documentKind: kind,
    isoAspect: mapping.aspect,
    annexHint: mapping.annexHint,
    version: 1,
    requiresSignature: false,
    signStatus: 'NONE',
    signedOff: false,
    events,
    occurredAt,
    retentionUntil: computeRetentionUntil(occurredAt, kind, opts.retentionPolicy),
    caseId: null,
    projectId: null,
    actorId: log.userId ?? null,
  };
}

export interface ProjectRecordTraceInput {
  id: string;
  projectId: string;
  subtype: 'PROGRESS' | 'EXCLUSION';
  title: string;
  at: Date;
  actorId?: string | null;
  detail?: string;
}

export function projectRecordToRecord(
  rec: ProjectRecordTraceInput,
  opts: BuildRecordOptions = {},
): TraceabilityRecord {
  const kind: IsoDocumentKind = 'PROJECT_RECORD';
  const mapping = resolveAspect(kind, opts.aspectMap);
  const occurredAt = assertDate(rec.at, 'projectRecord.at');
  const recordType: TraceRecordType = rec.subtype === 'EXCLUSION' ? 'EXCLUSION' : 'PROJECT_PROGRESS';
  const events: TraceEvent[] = [
    { action: 'RECORDED', actorId: rec.actorId ?? null, at: occurredAt, detail: rec.detail },
  ];
  return {
    recordType,
    recordId: rec.id,
    title: rec.title,
    documentKind: kind,
    isoAspect: mapping.aspect,
    annexHint: mapping.annexHint,
    version: 1,
    requiresSignature: false,
    signStatus: 'NONE',
    signedOff: false,
    events,
    occurredAt,
    retentionUntil: computeRetentionUntil(occurredAt, kind, opts.retentionPolicy),
    caseId: null,
    projectId: rec.projectId,
    actorId: rec.actorId ?? null,
  };
}

// 彙整 / 查閱 / 匯出

export interface TrailInputs {
  formSubmissions?: readonly FormSubmissionTraceInput[];
  attachments?: readonly AttachmentTraceInput[];
  logins?: readonly LoginTraceInput[];
  projectRecords?: readonly ProjectRecordTraceInput[];
}

export function buildTrail(inputs: TrailInputs, opts: BuildRecordOptions = {}): TraceabilityRecord[] {
  const out: TraceabilityRecord[] = [];
  for (const s of inputs.formSubmissions ?? []) out.push(formSubmissionToRecord(s, opts));
  for (const a of inputs.attachments ?? []) out.push(attachmentToRecord(a, opts));
  for (const l of inputs.logins ?? []) out.push(loginToRecord(l, opts));
  for (const p of inputs.projectRecords ?? []) out.push(projectRecordToRecord(p, opts));
  return out.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
}

export interface TrailFilter {
  recordTypes?: readonly TraceRecordType[];
  documentKinds?: readonly IsoDocumentKind[];
  from?: Date;
  to?: Date;
  caseId?: string;
  projectId?: string;
  actorId?: string;
  requiresSignatureOnly?: boolean;
  signedOff?: boolean;
}

export function filterTrail(
  records: readonly TraceabilityRecord[],
  filter: TrailFilter = {},
): TraceabilityRecord[] {
  return records.filter((r) => {
    if (filter.recordTypes && !filter.recordTypes.includes(r.recordType)) return false;
    if (filter.documentKinds && !filter.documentKinds.includes(r.documentKind)) return false;
    if (filter.from && r.occurredAt.getTime() < filter.from.getTime()) return false;
    if (filter.to && r.occurredAt.getTime() > filter.to.getTime()) return false;
    if (filter.caseId && r.caseId !== filter.caseId) return false;
    if (filter.projectId && r.projectId !== filter.projectId) return false;
    if (filter.actorId && r.actorId !== filter.actorId) return false;
    if (filter.requiresSignatureOnly && !r.requiresSignature) return false;
    if (filter.signedOff !== undefined && r.signedOff !== filter.signedOff) return false;
    return true;
  });
}

export function pendingSignatures(records: readonly TraceabilityRecord[]): TraceabilityRecord[] {
  return records.filter((r) => r.requiresSignature && !r.signedOff);
}

export interface TrailSummary {
  total: number;
  byType: Record<string, number>;
  byAspect: Record<string, number>;
  signableCount: number;
  signedCount: number;
  pendingSignatureCount: number;
  expiredRetentionCount: number;
}

export function summarizeTrail(
  records: readonly TraceabilityRecord[],
  now: Date = new Date(),
): TrailSummary {
  assertDate(now, 'summarizeTrail.now');
  const byType: Record<string, number> = {};
  const byAspect: Record<string, number> = {};
  let signableCount = 0;
  let signedCount = 0;
  let pendingSignatureCount = 0;
  let expiredRetentionCount = 0;
  for (const r of records) {
    byType[r.recordType] = (byType[r.recordType] ?? 0) + 1;
    byAspect[r.isoAspect] = (byAspect[r.isoAspect] ?? 0) + 1;
    if (r.requiresSignature) {
      signableCount += 1;
      if (r.signedOff) signedCount += 1;
      else pendingSignatureCount += 1;
    }
    if (isRetentionExpired(r, now)) expiredRetentionCount += 1;
  }
  return {
    total: records.length,
    byType,
    byAspect,
    signableCount,
    signedCount,
    pendingSignatureCount,
    expiredRetentionCount,
  };
}

// 匯出（查閱 / 稽核）

export interface AuditExportRow {
  recordType: string;
  recordId: string;
  title: string;
  documentKind: string;
  isoAspect: string;
  annexHint: string;
  version: number;
  requiresSignature: boolean;
  signStatus: string;
  signedOff: boolean;
  occurredAt: string;
  retentionUntil: string;
  caseId: string;
  projectId: string;
  actorId: string;
  trail: string;
}

export const AUDIT_EXPORT_COLUMNS: ReadonlyArray<keyof AuditExportRow> = [
  'recordType',
  'recordId',
  'title',
  'documentKind',
  'isoAspect',
  'annexHint',
  'version',
  'requiresSignature',
  'signStatus',
  'signedOff',
  'occurredAt',
  'retentionUntil',
  'caseId',
  'projectId',
  'actorId',
  'trail',
];

function trailToText(events: readonly TraceEvent[]): string {
  return events
    .map((e) => e.at.toISOString() + ' ' + e.action + (e.actorId ? ' by ' + e.actorId : '') + (e.detail ? ' (' + e.detail + ')' : ''))
    .join(' | ');
}

export function toAuditExportRows(records: readonly TraceabilityRecord[]): AuditExportRow[] {
  return records.map((r) => ({
    recordType: r.recordType,
    recordId: r.recordId,
    title: r.title,
    documentKind: r.documentKind,
    isoAspect: r.isoAspect,
    annexHint: r.annexHint ?? '',
    version: r.version,
    requiresSignature: r.requiresSignature,
    signStatus: r.signStatus,
    signedOff: r.signedOff,
    occurredAt: r.occurredAt.toISOString(),
    retentionUntil: r.retentionUntil ? toIsoDate(r.retentionUntil) : '',
    caseId: r.caseId ?? '',
    projectId: r.projectId ?? '',
    actorId: r.actorId ?? '',
    trail: trailToText(r.events),
  }));
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(rows: readonly AuditExportRow[]): string {
  const header = AUDIT_EXPORT_COLUMNS.join(',');
  const lines = rows.map((row) => AUDIT_EXPORT_COLUMNS.map((c) => csvCell(row[c])).join(','));
  return [header, ...lines].join('\n');
}

export interface AuditExport {
  generatedAt: string;
  summary: TrailSummary;
  pendingSignatureIds: string[];
  rows: AuditExportRow[];
}

export function buildAuditExport(
  records: readonly TraceabilityRecord[],
  now: Date = new Date(),
): AuditExport {
  return {
    generatedAt: assertDate(now, 'buildAuditExport.now').toISOString(),
    summary: summarizeTrail(records, now),
    pendingSignatureIds: pendingSignatures(records).map((r) => r.recordId),
    rows: toAuditExportRows(records),
  };
}
