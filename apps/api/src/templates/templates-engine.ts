/**
 * 作業範本附檔引擎核心（純領域邏輯，無 DB 相依）。
 *
 * 對應需求規格 §8.1「流程定義（彈性）」：
 * - 每個流程步驟可附加作業範本檔（表單範本、檢核表、SOP 文件），供承辦人員下載填寫。
 * - 範本需具版本控管（對應 ISO §11.2「作業範本檔（流程步驟）→ 文件化資訊管制、範本版本控管」）。
 *
 * 本檔僅負責「決策／驗證」：給定步驟既有範本與一筆新範本輸入，
 * 算出「輸入是否合法」「新版本號應為多少」「某步驟目前可下載的最新範本」
 * 以及「某範本的版本歷史（可追溯）」。
 * 真正的資料庫寫入由 TemplatesService 依計畫（plan）執行，使核心可被純函式單元測試覆蓋。
 *
 * 版本模型：以 (stepId, name) 作為「同一份範本」的識別；每次上傳同名範本即累加版本，
 * 下載時取最新版，歷史則保留所有版本供追溯。與 forms-engine 同風格（純函式 + plan）。
 */

/** 範本附加方式（檔案上傳或外部連結，對應需求規格 §8.6）。 */
export type TemplateSourceType = 'FILE' | 'LINK';

/** 步驟作業範本最小欄位（對應 Prisma StepTemplate）。 */
export interface EngineStepTemplate {
  id?: string;
  stepId: string;
  name: string;
  fileUrl?: string | null;
  linkUrl?: string | null;
  fileType?: string | null;
  version: number;
  createdAt?: Date;
}

/** 新增範本（或範本新版本）的輸入。 */
export interface TemplateInput {
  stepId: string;
  name: string;
  /** 檔案附件 URL（與 linkUrl 二擇一）。 */
  fileUrl?: string | null;
  /** 外部連結 URL，如 SharePoint / OneDrive（與 fileUrl 二擇一）。 */
  linkUrl?: string | null;
  fileType?: string | null;
}

export type TemplatesEngineErrorCode =
  | 'missing_name'
  | 'missing_source'
  | 'both_sources'
  | 'step_mismatch'
  | 'template_not_found';

/** 引擎錯誤；以 code 表示原因，方便上層轉成對應 HTTP 例外或訊息。 */
export class TemplatesEngineError extends Error {
  constructor(
    public readonly code: TemplatesEngineErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'TemplatesEngineError';
  }
}

/** 去除前後空白；非字串回傳空字串。 */
function trimStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * 驗證範本輸入是否合法：
 * - name 必填（去空白後非空）。
 * - 必須提供「檔案附件」或「外部連結」其一（fileUrl / linkUrl），且不可同時提供兩者。
 * 回傳錯誤代碼陣列（空陣列代表合法）。
 */
export function validateTemplateInput(
  input: TemplateInput,
): TemplatesEngineErrorCode[] {
  const errors: TemplatesEngineErrorCode[] = [];
  if (trimStr(input.name).length === 0) errors.push('missing_name');

  const hasFile = trimStr(input.fileUrl).length > 0;
  const hasLink = trimStr(input.linkUrl).length > 0;
  if (!hasFile && !hasLink) errors.push('missing_source');
  if (hasFile && hasLink) errors.push('both_sources');

  return errors;
}

/** 驗證範本輸入，不合法則丟出 TemplatesEngineError。 */
export function assertValidTemplateInput(input: TemplateInput): void {
  const errors = validateTemplateInput(input);
  if (errors.length > 0) {
    throw new TemplatesEngineError(errors[0]);
  }
}

/** 判斷某範本的附加方式（依是否有 fileUrl 判定）。 */
export function sourceTypeOf(t: {
  fileUrl?: string | null;
  linkUrl?: string | null;
}): TemplateSourceType {
  return trimStr(t.fileUrl).length > 0 ? 'FILE' : 'LINK';
}

/**
 * 計算某步驟同名範本的「下一個版本號」。
 * - 取既有 (stepId, name) 範本中最大的 version，+1；若無則為 1。
 * 比較時 name 以去空白後比對。
 */
export function nextVersion(
  existing: readonly EngineStepTemplate[],
  stepId: string,
  name: string,
): number {
  const key = trimStr(name);
  let max = 0;
  for (const t of existing) {
    if (t.stepId === stepId && trimStr(t.name) === key) {
      if (t.version > max) max = t.version;
    }
  }
  return max + 1;
}

/** 建立範本（或新版本）的計畫。 */
export interface TemplatePlan {
  stepId: string;
  name: string;
  fileUrl: string | null;
  linkUrl: string | null;
  fileType: string | null;
  version: number;
  sourceType: TemplateSourceType;
  createdAt: Date;
}

/**
 * 計算「新增範本／上傳新版本」的計畫。
 * - 先驗證輸入；不合法丟出 TemplatesEngineError。
 * - 合法則依既有同名範本算出版本號（首版為 1，同名再上傳則 +1）。
 */
export function planCreateTemplate(
  existing: readonly EngineStepTemplate[],
  input: TemplateInput,
  now: Date = new Date(),
): TemplatePlan {
  assertValidTemplateInput(input);
  const name = trimStr(input.name);
  const hasFile = trimStr(input.fileUrl).length > 0;
  return {
    stepId: input.stepId,
    name,
    fileUrl: hasFile ? trimStr(input.fileUrl) : null,
    linkUrl: hasFile ? null : trimStr(input.linkUrl),
    fileType: input.fileType ?? null,
    version: nextVersion(existing, input.stepId, name),
    sourceType: hasFile ? 'FILE' : 'LINK',
    createdAt: now,
  };
}

/** a 是否比 b 為「更新的版本」（version 較大；相同則 createdAt 較新）。 */
function isNewer(a: EngineStepTemplate, b: EngineStepTemplate): boolean {
  if (a.version !== b.version) return a.version > b.version;
  const at = a.createdAt?.getTime() ?? 0;
  const bt = b.createdAt?.getTime() ?? 0;
  return at >= bt;
}

/**
 * 取出每個範本名稱的「最新版本」。
 * 回傳 Map：name → 最新一筆 EngineStepTemplate。
 */
export function latestVersionByName(
  templates: readonly EngineStepTemplate[],
): Map<string, EngineStepTemplate> {
  const out = new Map<string, EngineStepTemplate>();
  for (const t of templates) {
    const key = trimStr(t.name);
    const prev = out.get(key);
    if (!prev || isNewer(t, prev)) out.set(key, t);
  }
  return out;
}

/** 以 Unicode code point 穩定比較字串（不受執行環境 locale 影響）。 */
function compareByCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 列出某步驟「目前可下載」的範本清單（每個名稱只取最新版），依名稱排序。
 * 供案件承辦於步驟中下載最新作業範本。
 */
export function latestTemplates(
  templates: readonly EngineStepTemplate[],
): EngineStepTemplate[] {
  return [...latestVersionByName(templates).values()].sort((a, b) =>
    compareByCodePoint(trimStr(a.name), trimStr(b.name)),
  );
}

/**
 * 某範本（依名稱）的版本歷史，依版本由新到舊排序（可追溯）。
 */
export function templateHistory(
  templates: readonly EngineStepTemplate[],
  name: string,
): EngineStepTemplate[] {
  const key = trimStr(name);
  return templates
    .filter((t) => trimStr(t.name) === key)
    .sort((a, b) => {
      if (a.version !== b.version) return b.version - a.version;
      const at = a.createdAt?.getTime() ?? 0;
      const bt = b.createdAt?.getTime() ?? 0;
      return bt - at;
    });
}

/** 下載目標（解析後的可下載資訊，含可追溯來源）。 */
export interface DownloadTarget {
  templateId?: string;
  name: string;
  version: number;
  sourceType: TemplateSourceType;
  /** 實際下載／開啟的 URL（檔案或連結）。 */
  url: string;
  fileType: string | null;
}

/**
 * 解析某範本名稱目前可下載的最新版本。
 * - 找不到該名稱範本則丟出 TemplatesEngineError('template_not_found')。
 */
export function resolveDownload(
  templates: readonly EngineStepTemplate[],
  name: string,
): DownloadTarget {
  const latest = latestVersionByName(templates).get(trimStr(name));
  if (!latest) throw new TemplatesEngineError('template_not_found');
  const sourceType = sourceTypeOf(latest);
  return {
    templateId: latest.id,
    name: trimStr(latest.name),
    version: latest.version,
    sourceType,
    url: sourceType === 'FILE' ? trimStr(latest.fileUrl) : trimStr(latest.linkUrl),
    fileType: latest.fileType ?? null,
  };
}

/** 列出某步驟所有不重複的範本名稱（依名稱排序）。 */
export function distinctTemplateNames(
  templates: readonly EngineStepTemplate[],
): string[] {
  const set = new Set<string>();
  for (const t of templates) set.add(trimStr(t.name));
  return [...set].sort(compareByCodePoint);
}
