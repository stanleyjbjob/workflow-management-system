/**
 * 附件與連結管理引擎核心（純領域邏輯，無 DB 相依）。
 *
 * 對應需求規格 §8.6「附件與連結」：
 * - 任務／步驟／表單可加掛附件：上傳檔案（存於系統並與目標綁定），或以外部連結引用。
 * - 連結優先支援 SharePoint / OneDrive，並沿用 Microsoft 365 既有雲端權限（不複製檔案，存取由 M365 ACL 控管）。
 * - 記錄上傳者、時間、版本，永久留存可調閱（ISO 27001 文件化軌跡）。
 *
 * 本檔僅負責「決策／驗證」：給定某目標（案件／步驟實例／表單提交）既有附件與一筆新輸入，
 * 算出「輸入是否合法」「附加方式（檔案／連結）」「連結供應商與權限模型」「新版本號」，
 * 以及「目前可下載的最新附件」「版本歷史（可追溯）」。
 * 真正的資料庫寫入由 AttachmentsService 依計畫（plan）執行，使核心可被純函式單元測試覆蓋。
 *
 * 版本模型：以（目標 + name）作為「同一份附件」的識別；每次上傳同名附件即累加版本，
 * 下載時取最新版，歷史則保留所有版本供追溯（與 templates-engine 同風格：純函式 + plan）。
 */

/** 附件附加方式（檔案上傳或外部連結）。 */
export type AttachmentSourceType = 'FILE' | 'LINK';

/** 連結供應商（用於判斷是否沿用 Microsoft 365 權限）。 */
export type LinkProvider = 'SHAREPOINT' | 'ONEDRIVE' | 'OTHER';

/**
 * 權限模型：
 * - SYSTEM：檔案存於本系統，權限由系統 RBAC 控管。
 * - M365_INHERITED：SharePoint / OneDrive 連結，沿用 Microsoft 365 既有雲端權限。
 * - EXTERNAL：非 M365 的外部連結，權限由該外部來源自行控管。
 */
export type PermissionModel = 'SYSTEM' | 'M365_INHERITED' | 'EXTERNAL';

/** 附件可綁定的目標種類（對應需求規格 §8.6「任務／步驟／表單」）。 */
export type AttachmentTargetKind = 'CASE' | 'STEP_INSTANCE' | 'FORM_SUBMISSION';

/** 附件可綁定的目標（三者擇一）。 */
export interface AttachmentTarget {
  caseId?: string | null;
  stepInstanceId?: string | null;
  formSubmissionId?: string | null;
}

/** 附件最小欄位（對應 Prisma Attachment）。 */
export interface EngineAttachment extends AttachmentTarget {
  id?: string;
  name: string;
  type?: AttachmentSourceType;
  fileUrl?: string | null;
  linkUrl?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  version: number;
  uploadedById?: string | null;
  createdAt?: Date;
}

/** 新增附件（或附件新版本）的輸入。 */
export interface AttachmentInput extends AttachmentTarget {
  name: string;
  /** 檔案附件 URL（與 linkUrl 二擇一）。 */
  fileUrl?: string | null;
  /** 外部連結 URL，如 SharePoint / OneDrive（與 fileUrl 二擇一）。 */
  linkUrl?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  /** 上傳者使用者 id（用於記錄上傳者）。 */
  uploadedById?: string | null;
}

export type AttachmentsEngineErrorCode =
  | 'missing_name'
  | 'missing_source'
  | 'both_sources'
  | 'missing_target'
  | 'multiple_targets'
  | 'invalid_size'
  | 'attachment_not_found';

/** 引擎錯誤；以 code 表示原因，方便上層轉成對應 HTTP 例外或訊息。 */
export class AttachmentsEngineError extends Error {
  constructor(
    public readonly code: AttachmentsEngineErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'AttachmentsEngineError';
  }
}

/** 去除前後空白；非字串回傳空字串。 */
function trimStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** 解析後的目標（種類 + id）。 */
export interface ResolvedTarget {
  kind: AttachmentTargetKind;
  id: string;
}

/**
 * 驗證並解析附件目標：必須剛好提供一個目標（caseId／stepInstanceId／formSubmissionId）。
 * - 完全未提供 → missing_target。
 * - 同時提供多個 → multiple_targets。
 */
export function resolveTarget(target: AttachmentTarget): ResolvedTarget {
  const entries: ResolvedTarget[] = [];
  if (trimStr(target.caseId).length > 0)
    entries.push({ kind: 'CASE', id: trimStr(target.caseId) });
  if (trimStr(target.stepInstanceId).length > 0)
    entries.push({ kind: 'STEP_INSTANCE', id: trimStr(target.stepInstanceId) });
  if (trimStr(target.formSubmissionId).length > 0)
    entries.push({ kind: 'FORM_SUBMISSION', id: trimStr(target.formSubmissionId) });

  if (entries.length === 0) throw new AttachmentsEngineError('missing_target');
  if (entries.length > 1) throw new AttachmentsEngineError('multiple_targets');
  return entries[0];
}

/** 兩筆附件是否綁定到同一目標（三個目標欄位皆相同）。 */
export function sameTarget(a: AttachmentTarget, b: AttachmentTarget): boolean {
  return (
    trimStr(a.caseId) === trimStr(b.caseId) &&
    trimStr(a.stepInstanceId) === trimStr(b.stepInstanceId) &&
    trimStr(a.formSubmissionId) === trimStr(b.formSubmissionId)
  );
}

/**
 * 判斷連結供應商（依 host 判定）。
 * - *.sharepoint.com（含 OneDrive for Business 的 *-my.sharepoint.com）。
 * - onedrive.live.com / 1drv.ms（個人 OneDrive 短連結）。
 */
export function linkProvider(url: string | null | undefined): LinkProvider {
  const raw = trimStr(url);
  if (raw.length === 0) return 'OTHER';
  let host = '';
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return 'OTHER';
  }
  if (host === '1drv.ms' || host.endsWith('.1drv.ms')) return 'ONEDRIVE';
  if (host === 'onedrive.live.com' || host.endsWith('.onedrive.live.com'))
    return 'ONEDRIVE';
  if (host.endsWith('sharepoint.com')) {
    // *-my.sharepoint.com 為 OneDrive for Business，其餘為 SharePoint。
    return host.includes('-my.') ? 'ONEDRIVE' : 'SHAREPOINT';
  }
  return 'OTHER';
}

/** 連結是否為 Microsoft 365（SharePoint / OneDrive）來源。 */
export function isM365Link(url: string | null | undefined): boolean {
  return linkProvider(url) !== 'OTHER';
}

/** 判斷某附件的附加方式（依是否有 fileUrl 判定）。 */
export function sourceTypeOf(a: {
  fileUrl?: string | null;
  linkUrl?: string | null;
}): AttachmentSourceType {
  return trimStr(a.fileUrl).length > 0 ? 'FILE' : 'LINK';
}

/**
 * 計算附件的權限模型：
 * - 檔案 → SYSTEM（存於系統，權限由系統控管）。
 * - SharePoint / OneDrive 連結 → M365_INHERITED（沿用 Microsoft 365 既有雲端權限）。
 * - 其他連結 → EXTERNAL。
 */
export function permissionModelOf(a: {
  fileUrl?: string | null;
  linkUrl?: string | null;
}): PermissionModel {
  if (sourceTypeOf(a) === 'FILE') return 'SYSTEM';
  return isM365Link(a.linkUrl) ? 'M365_INHERITED' : 'EXTERNAL';
}

/**
 * 驗證附件輸入是否合法：
 * - name 必填（去空白後非空）。
 * - 必須提供「檔案附件」或「外部連結」其一（fileUrl / linkUrl），且不可同時提供兩者。
 * - 必須剛好綁定一個目標（案件／步驟實例／表單提交）。
 * - sizeBytes 若提供須為非負整數。
 * 回傳錯誤代碼陣列（空陣列代表合法）。
 */
export function validateAttachmentInput(
  input: AttachmentInput,
): AttachmentsEngineErrorCode[] {
  const errors: AttachmentsEngineErrorCode[] = [];
  if (trimStr(input.name).length === 0) errors.push('missing_name');

  const hasFile = trimStr(input.fileUrl).length > 0;
  const hasLink = trimStr(input.linkUrl).length > 0;
  if (!hasFile && !hasLink) errors.push('missing_source');
  if (hasFile && hasLink) errors.push('both_sources');

  try {
    resolveTarget(input);
  } catch (e) {
    if (e instanceof AttachmentsEngineError) errors.push(e.code);
    else throw e;
  }

  if (
    input.sizeBytes !== undefined &&
    input.sizeBytes !== null &&
    (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 0)
  ) {
    errors.push('invalid_size');
  }

  return errors;
}

/** 驗證附件輸入，不合法則丟出 AttachmentsEngineError。 */
export function assertValidAttachmentInput(input: AttachmentInput): void {
  const errors = validateAttachmentInput(input);
  if (errors.length > 0) {
    throw new AttachmentsEngineError(errors[0]);
  }
}

/**
 * 計算某目標同名附件的「下一個版本號」。
 * - 取既有（同目標、同 name）附件中最大的 version，+1；若無則為 1。
 * 比較時 name 以去空白後比對。
 */
export function nextVersion(
  existing: readonly EngineAttachment[],
  target: AttachmentTarget,
  name: string,
): number {
  const key = trimStr(name);
  let max = 0;
  for (const a of existing) {
    if (sameTarget(a, target) && trimStr(a.name) === key) {
      if (a.version > max) max = a.version;
    }
  }
  return max + 1;
}

/** 建立附件（或新版本）的計畫。 */
export interface AttachmentPlan extends ResolvedTarget {
  name: string;
  sourceType: AttachmentSourceType;
  type: AttachmentSourceType;
  fileUrl: string | null;
  linkUrl: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  version: number;
  uploadedById: string | null;
  provider: LinkProvider;
  permissionModel: PermissionModel;
  createdAt: Date;
}

/**
 * 計算「新增附件／上傳新版本」的計畫。
 * - 先驗證輸入；不合法丟出 AttachmentsEngineError。
 * - 合法則依既有同目標同名附件算出版本號（首版為 1，同名再上傳則 +1）。
 * - 自動推導附加方式、連結供應商與權限模型；檔案型清空 linkUrl、連結型清空 fileUrl。
 */
export function planCreateAttachment(
  existing: readonly EngineAttachment[],
  input: AttachmentInput,
  now: Date = new Date(),
): AttachmentPlan {
  assertValidAttachmentInput(input);
  const resolved = resolveTarget(input);
  const name = trimStr(input.name);
  const hasFile = trimStr(input.fileUrl).length > 0;
  const sourceType: AttachmentSourceType = hasFile ? 'FILE' : 'LINK';
  const fileUrl = hasFile ? trimStr(input.fileUrl) : null;
  const linkUrl = hasFile ? null : trimStr(input.linkUrl);
  const provider = sourceType === 'LINK' ? linkProvider(linkUrl) : 'OTHER';
  const permissionModel = permissionModelOf({ fileUrl, linkUrl });

  return {
    kind: resolved.kind,
    id: resolved.id,
    name,
    sourceType,
    type: sourceType,
    fileUrl,
    linkUrl,
    mimeType: trimStr(input.mimeType).length > 0 ? trimStr(input.mimeType) : null,
    sizeBytes:
      input.sizeBytes === undefined || input.sizeBytes === null
        ? null
        : input.sizeBytes,
    version: nextVersion(existing, input, name),
    uploadedById:
      trimStr(input.uploadedById).length > 0 ? trimStr(input.uploadedById) : null,
    provider,
    permissionModel,
    createdAt: now,
  };
}

/** a 是否比 b 為「更新的版本」（version 較大；相同則 createdAt 較新）。 */
function isNewer(a: EngineAttachment, b: EngineAttachment): boolean {
  if (a.version !== b.version) return a.version > b.version;
  const at = a.createdAt?.getTime() ?? 0;
  const bt = b.createdAt?.getTime() ?? 0;
  return at >= bt;
}

/**
 * 取出每個附件名稱的「最新版本」。
 * 回傳 Map：name → 最新一筆 EngineAttachment。
 */
export function latestVersionByName(
  attachments: readonly EngineAttachment[],
): Map<string, EngineAttachment> {
  const out = new Map<string, EngineAttachment>();
  for (const a of attachments) {
    const key = trimStr(a.name);
    const prev = out.get(key);
    if (!prev || isNewer(a, prev)) out.set(key, a);
  }
  return out;
}

/**
 * 列出某目標「目前可下載」的附件清單（每個名稱只取最新版），依名稱排序。
 */
export function latestAttachments(
  attachments: readonly EngineAttachment[],
): EngineAttachment[] {
  return [...latestVersionByName(attachments).values()].sort((a, b) =>
    trimStr(a.name).localeCompare(trimStr(b.name)),
  );
}

/**
 * 某附件（依名稱）的版本歷史，依版本由新到舊排序（可追溯）。
 */
export function attachmentHistory(
  attachments: readonly EngineAttachment[],
  name: string,
): EngineAttachment[] {
  const key = trimStr(name);
  return attachments
    .filter((a) => trimStr(a.name) === key)
    .sort((a, b) => {
      if (a.version !== b.version) return b.version - a.version;
      const at = a.createdAt?.getTime() ?? 0;
      const bt = b.createdAt?.getTime() ?? 0;
      return bt - at;
    });
}

/** 下載／開啟目標（解析後的可下載資訊，含可追溯來源與權限模型）。 */
export interface DownloadTarget {
  attachmentId?: string;
  name: string;
  version: number;
  sourceType: AttachmentSourceType;
  /** 實際下載／開啟的 URL（檔案或連結）。 */
  url: string;
  mimeType: string | null;
  provider: LinkProvider;
  permissionModel: PermissionModel;
  uploadedById: string | null;
  uploadedAt: Date | null;
}

/**
 * 解析某附件名稱目前可下載的最新版本。
 * - 找不到該名稱附件則丟出 AttachmentsEngineError('attachment_not_found')。
 */
export function resolveDownload(
  attachments: readonly EngineAttachment[],
  name: string,
): DownloadTarget {
  const latest = latestVersionByName(attachments).get(trimStr(name));
  if (!latest) throw new AttachmentsEngineError('attachment_not_found');
  const sourceType = sourceTypeOf(latest);
  return {
    attachmentId: latest.id,
    name: trimStr(latest.name),
    version: latest.version,
    sourceType,
    url:
      sourceType === 'FILE' ? trimStr(latest.fileUrl) : trimStr(latest.linkUrl),
    mimeType: latest.mimeType ?? null,
    provider: sourceType === 'LINK' ? linkProvider(latest.linkUrl) : 'OTHER',
    permissionModel: permissionModelOf(latest),
    uploadedById: latest.uploadedById ?? null,
    uploadedAt: latest.createdAt ?? null,
  };
}

/** 列出某目標所有不重複的附件名稱（依名稱排序）。 */
export function distinctAttachmentNames(
  attachments: readonly EngineAttachment[],
): string[] {
  const set = new Set<string>();
  for (const a of attachments) set.add(trimStr(a.name));
  return [...set].sort((a, b) => a.localeCompare(b));
}
