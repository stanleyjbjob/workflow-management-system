import { CaseStatus, SaleMode } from '@prisma/client';

/**
 * 銷售流程引擎核心（純領域邏輯，無 DB 相依）。
 *
 * 對應需求規格 §4「銷售流程（業務）」：
 * - 建立商機：客戶來源（可多選分類）、產品項目、銷售模式（買斷 / 訂閱）。 §4.2~4.4
 * - 拜訪 / Demo / 會議記錄：可多次新增、永久留存並可調閱（append-only）。 §4.5 步驟2、§4.6
 * - 報價單、客製需求文件：成案時自動帶往後續導入 / 客製化階段。 §4.5 步驟3~5a、§4.6
 * - 失敗原因：可結構化分類，供後續統計與改善分析。 §4.5 步驟5b、§4.6
 *
 * 本檔僅負責「決策」與「結構化」：給定商機資料、紀錄與產出，
 * 算出驗證結果、移交藍圖（handoff）、失敗紀錄與統計。
 * 真正的資料庫寫入由 SalesService 依結果執行，使核心可被純函式單元測試覆蓋
 * （與 workflow / forms / templates / attachments 引擎一致）。
 */

/* ────────────────────────── 列舉與常數 ────────────────────────── */

/** 客戶來源分類（§4.2，可多選）。 */
export enum LeadSource {
  /** 行銷管道 */
  MARKETING = 'MARKETING',
  /** 客戶介紹客戶（轉介） */
  CUSTOMER_REFERRAL = 'CUSTOMER_REFERRAL',
  /** 業務自行開發 */
  SELF_DEVELOPED = 'SELF_DEVELOPED',
  /** 舊系統客戶升級 */
  LEGACY_UPGRADE = 'LEGACY_UPGRADE',
  /** 內部轉介 */
  INTERNAL_REFERRAL = 'INTERNAL_REFERRAL',
}

export const ALL_LEAD_SOURCES: readonly LeadSource[] = Object.values(LeadSource);

/**
 * 產品項目（§4.3）。以已知清單作為建議值，但不強制——
 * 部門可能新增產品，故 validate 僅要求「非空字串」，
 * 另提供 isKnownProduct 供 UI 提示。
 */
export const KNOWN_PRODUCTS: readonly string[] = [
  '人事系統',
  '員工入口網站',
  '績效考核',
  '教育訓練',
  '職能',
  '招募',
];

export function isKnownProduct(name: string): boolean {
  return KNOWN_PRODUCTS.includes(name);
}

/** 拜訪 / 會議紀錄類型（§4.5 步驟2）。 */
export enum SalesRecordKind {
  VISIT = 'VISIT',
  DEMO = 'DEMO',
  MEETING = 'MEETING',
}

/** 銷售產出文件類型（§4.5 步驟3~5a）。 */
export enum SalesDocKind {
  /** 報價單 */
  QUOTE = 'QUOTE',
  /** 客製需求文件 */
  CUSTOM_REQUIREMENT = 'CUSTOM_REQUIREMENT',
}

/* ────────────────────────── 錯誤型別 ────────────────────────── */

export type SalesEngineErrorCode =
  | 'title_required'
  | 'client_required'
  | 'lead_source_required'
  | 'invalid_lead_source'
  | 'duplicate_lead_source'
  | 'product_required'
  | 'sale_mode_required'
  | 'record_summary_required'
  | 'record_invalid_kind'
  | 'record_corrupt'
  | 'doc_name_required'
  | 'doc_invalid_kind'
  | 'no_final_quote'
  | 'failure_reason_required'
  | 'failure_category_required';

export class SalesEngineError extends Error {
  constructor(
    public readonly code: SalesEngineErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'SalesEngineError';
  }
}

/* ────────────────────────── 商機（Opportunity） ────────────────────────── */

/** 建立商機的輸入（§4.5 步驟1）。 */
export interface OpportunityInput {
  /** 商機 / 案件標題 */
  title: string;
  /** 客戶名稱 */
  clientName: string;
  /** 客戶來源（可多選，至少一項） */
  leadSources: readonly LeadSource[];
  /** 產品項目（至少一項，非空字串） */
  products: readonly string[];
  /** 銷售模式：買斷 / 訂閱 */
  saleMode: SaleMode;
}

/** 正規化後的商機資料（去重來源、去除空白產品）。 */
export interface NormalizedOpportunity {
  title: string;
  clientName: string;
  leadSources: LeadSource[];
  products: string[];
  saleMode: SaleMode;
}

function isLeadSource(v: unknown): v is LeadSource {
  return typeof v === 'string' && (ALL_LEAD_SOURCES as string[]).includes(v);
}

/**
 * 驗證商機輸入，回傳錯誤代碼陣列（空陣列代表合法）。
 */
export function validateOpportunity(input: OpportunityInput): SalesEngineErrorCode[] {
  const errors: SalesEngineErrorCode[] = [];

  if (!input.title || input.title.trim().length === 0) errors.push('title_required');
  if (!input.clientName || input.clientName.trim().length === 0)
    errors.push('client_required');

  if (!input.leadSources || input.leadSources.length === 0) {
    errors.push('lead_source_required');
  } else {
    if (input.leadSources.some((s) => !isLeadSource(s))) errors.push('invalid_lead_source');
    const seen = new Set<LeadSource>();
    for (const s of input.leadSources) {
      if (seen.has(s)) {
        errors.push('duplicate_lead_source');
        break;
      }
      seen.add(s);
    }
  }

  const cleanProducts = (input.products ?? []).filter((p) => p && p.trim().length > 0);
  if (cleanProducts.length === 0) errors.push('product_required');

  if (input.saleMode !== SaleMode.PURCHASE && input.saleMode !== SaleMode.SUBSCRIPTION) {
    errors.push('sale_mode_required');
  }

  return errors;
}

export function assertValidOpportunity(input: OpportunityInput): void {
  const errors = validateOpportunity(input);
  if (errors.length > 0) throw new SalesEngineError(errors[0]);
}

/** 正規化商機（驗證通過後）：去重來源、trim、去空產品。 */
export function normalizeOpportunity(input: OpportunityInput): NormalizedOpportunity {
  assertValidOpportunity(input);
  return {
    title: input.title.trim(),
    clientName: input.clientName.trim(),
    leadSources: [...new Set(input.leadSources)],
    products: [...new Set(input.products.map((p) => p.trim()).filter((p) => p.length > 0))],
    saleMode: input.saleMode,
  };
}

/* ────────────────── 拜訪 / 會議紀錄（append-only） ────────────────── */

/** 新增拜訪 / 會議紀錄的輸入（§4.5 步驟2）。 */
export interface SalesRecordInput {
  kind: SalesRecordKind;
  /** 紀錄摘要（必填，永久留存） */
  summary: string;
  /** 發生時間；未提供則以 now 帶入 */
  occurredAt?: Date;
  /** 與會者（選填） */
  attendees?: readonly string[];
  /** 詳細內容（選填） */
  detail?: string;
}

/** 已物化的拜訪 / 會議紀錄（不可變、永久留存）。 */
export interface SalesRecord {
  kind: SalesRecordKind;
  summary: string;
  occurredAt: Date;
  attendees: string[];
  detail: string | null;
}

function isSalesRecordKind(v: unknown): v is SalesRecordKind {
  return v === SalesRecordKind.VISIT || v === SalesRecordKind.DEMO || v === SalesRecordKind.MEETING;
}

export function validateSalesRecord(input: SalesRecordInput): SalesEngineErrorCode[] {
  const errors: SalesEngineErrorCode[] = [];
  if (!isSalesRecordKind(input.kind)) errors.push('record_invalid_kind');
  if (!input.summary || input.summary.trim().length === 0) errors.push('record_summary_required');
  return errors;
}

export function assertValidSalesRecord(input: SalesRecordInput): void {
  const errors = validateSalesRecord(input);
  if (errors.length > 0) throw new SalesEngineError(errors[0]);
}

/**
 * 將輸入物化為一筆不可變紀錄。
 * 注意：引擎僅提供「新增」；不提供刪除 / 修改，以滿足 §4.6「可重複新增並永久留存」。
 * occurredAt 未提供時以 now 帶入。
 */
export function materializeSalesRecord(
  input: SalesRecordInput,
  now: Date = new Date(),
): SalesRecord {
  assertValidSalesRecord(input);
  return Object.freeze({
    kind: input.kind,
    summary: input.summary.trim(),
    occurredAt: input.occurredAt ?? now,
    attendees: [...(input.attendees ?? [])],
    detail: input.detail && input.detail.trim().length > 0 ? input.detail.trim() : null,
  });
}

/** 依發生時間由舊到新排序（不改動原陣列）。供調閱使用。 */
export function sortRecordsChronological(records: readonly SalesRecord[]): SalesRecord[] {
  return [...records].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}

/** 依類型篩選紀錄。 */
export function filterRecordsByKind(
  records: readonly SalesRecord[],
  kind: SalesRecordKind,
): SalesRecord[] {
  return records.filter((r) => r.kind === kind);
}

/* ────────────────── 拜訪 / 會議紀錄：持久化序列化 ────────────────── */

/**
 * 承載拜訪 / 會議紀錄落地的表單代碼。
 *
 * 設計：紀錄以 append-only 的 FormSubmission 落地（每筆一列、永不刪改），
 * 需要一個 code 固定的 FormDefinition 作為容器；SalesService 以此 code
 * 解析（或首次自動建立）該容器。沿用既有 forms 持久化機制，本輪不新增 migration。
 */
export const SALES_RECORD_FORM_CODE = 'SALES_VISIT_RECORD';

/** SalesRecord 的可序列化（JSON-safe）表達，存入 FormSubmission.data。 */
export interface SalesRecordData {
  kind: SalesRecordKind;
  summary: string;
  /** ISO 8601 字串（由 Date 轉出，還原時再轉回 Date）。 */
  occurredAt: string;
  attendees: string[];
  detail: string | null;
}

/** 將不可變紀錄轉為 JSON-safe 物件（occurredAt → ISO 字串）。 */
export function serializeSalesRecord(record: SalesRecord): SalesRecordData {
  return {
    kind: record.kind,
    summary: record.summary,
    occurredAt: record.occurredAt.toISOString(),
    attendees: [...record.attendees],
    detail: record.detail,
  };
}

/**
 * 將持久化的 JSON 物件還原為不可變 SalesRecord。
 * 對毀損 / 不合法資料丟出 SalesEngineError('record_corrupt')，避免污染調閱結果。
 */
export function deserializeSalesRecord(data: unknown): SalesRecord {
  if (!data || typeof data !== 'object') throw new SalesEngineError('record_corrupt');
  const d = data as Partial<SalesRecordData>;
  if (!isSalesRecordKind(d.kind)) throw new SalesEngineError('record_corrupt');
  if (typeof d.summary !== 'string' || d.summary.trim().length === 0)
    throw new SalesEngineError('record_corrupt');
  if (typeof d.occurredAt !== 'string') throw new SalesEngineError('record_corrupt');
  const occurredAt = new Date(d.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) throw new SalesEngineError('record_corrupt');
  const attendees = Array.isArray(d.attendees)
    ? d.attendees.filter((a): a is string => typeof a === 'string')
    : [];
  const detail =
    typeof d.detail === 'string' && d.detail.trim().length > 0 ? d.detail : null;
  return Object.freeze({
    kind: d.kind,
    summary: d.summary,
    occurredAt,
    attendees,
    detail,
  });
}

/* ────────────────── 銷售產出文件（報價單 / 客製需求） ────────────────── */

/** 銷售產出文件（對應 Attachment / FormSubmission 的引用）。 */
export interface SalesDoc {
  kind: SalesDocKind;
  /** 引用的附件 / 提交 id */
  refId: string;
  name: string;
  version: number;
  /** 是否為定版（報價單成案前需定版，§4.5 步驟5a） */
  isFinal?: boolean;
}

/** 取得某類型文件的最新版（version 最大）；無則回傳 null。 */
export function latestDoc(docs: readonly SalesDoc[], kind: SalesDocKind): SalesDoc | null {
  let latest: SalesDoc | null = null;
  for (const d of docs) {
    if (d.kind !== kind) continue;
    if (!latest || d.version > latest.version) latest = d;
  }
  return latest;
}

/** 取得定版報價單（isFinal 為 true 中 version 最大）；無則回傳 null。 */
export function finalQuote(docs: readonly SalesDoc[]): SalesDoc | null {
  let latest: SalesDoc | null = null;
  for (const d of docs) {
    if (d.kind !== SalesDocKind.QUOTE || !d.isFinal) continue;
    if (!latest || d.version > latest.version) latest = d;
  }
  return latest;
}

/* ────────────────────────── 成案移交（Win → 導入） ────────────────────────── */

/**
 * 成案移交藍圖：自動帶往後續導入 / 客製化階段的產出（§4.6）。
 * - 報價單（定版）
 * - 客製需求文件（最新版，若有）
 */
export interface HandoffPayload {
  caseStatus: CaseStatus;
  finalQuote: SalesDoc;
  customRequirement: SalesDoc | null;
  /** 一併帶往的所有產出引用 refId（供導入流程引用） */
  carriedDocRefIds: string[];
}

/**
 * 計算「成案」的移交計畫。
 * - 必須存在定版報價單；否則拋出 no_final_quote（成案前須完成報價定版，§4.5 步驟3/5a）。
 * - 客製需求文件為選填（部分案件無客製需求）。
 * - 案件狀態轉為 COMPLETED（成案）。
 */
export function planWin(docs: readonly SalesDoc[]): HandoffPayload {
  const quote = finalQuote(docs);
  if (!quote) throw new SalesEngineError('no_final_quote');
  const custom = latestDoc(docs, SalesDocKind.CUSTOM_REQUIREMENT);

  const carried = [quote.refId];
  if (custom) carried.push(custom.refId);

  return {
    caseStatus: CaseStatus.COMPLETED,
    finalQuote: quote,
    customRequirement: custom,
    carriedDocRefIds: carried,
  };
}

/* ────────────────────────── 失敗結案（Loss） ────────────────────────── */

/**
 * 結構化失敗紀錄（§4.6「失敗原因需可結構化分類」）。
 *
 * 重要：失敗原因「分類項目」屬規格待釐清事項（§12-2），
 * 本引擎不臆測具體分類清單，僅要求 category 為非空代碼字串（可由部門設定 / Enum 擴充），
 * 並提供統計彙總函式。待 §12-2 確認後可將 category 收斂為固定 Enum。
 */
export interface FailureInput {
  /** 失敗分類代碼（待 §12-2 定義；本層僅要求非空） */
  category: string;
  /** 失敗原因說明（必填，永久留存供改善分析） */
  reason: string;
  occurredAt?: Date;
}

export interface FailureRecord {
  caseStatus: CaseStatus;
  category: string;
  reason: string;
  occurredAt: Date;
}

export function validateFailure(input: FailureInput): SalesEngineErrorCode[] {
  const errors: SalesEngineErrorCode[] = [];
  if (!input.category || input.category.trim().length === 0)
    errors.push('failure_category_required');
  if (!input.reason || input.reason.trim().length === 0) errors.push('failure_reason_required');
  return errors;
}

export function assertValidFailure(input: FailureInput): void {
  const errors = validateFailure(input);
  if (errors.length > 0) throw new SalesEngineError(errors[0]);
}

/** 計算「失敗結案」計畫：案件狀態轉 FAILED，留存分類與原因。 */
export function planLoss(input: FailureInput, now: Date = new Date()): FailureRecord {
  assertValidFailure(input);
  return {
    caseStatus: CaseStatus.FAILED,
    category: input.category.trim(),
    reason: input.reason.trim(),
    occurredAt: input.occurredAt ?? now,
  };
}

/** 失敗原因統計：依分類彙總筆數（§4.6 供統計與改善分析）。 */
export function summarizeFailureReasons(
  records: readonly Pick<FailureRecord, 'category'>[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of records) {
    out[r.category] = (out[r.category] ?? 0) + 1;
  }
  return out;
}
