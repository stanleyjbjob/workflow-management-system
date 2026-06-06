import { FieldType, SubmissionStatus } from '@prisma/client';

/**
 * 表單與產出文件引擎核心（純領域邏輯，無 DB 相依）。
 *
 * 對應需求規格 §8.2「表單與產出文件管理（彈性）」：
 * - 可自訂表單欄位（型別、必填、選項），並掛載到流程步驟。
 * - 簽核類表單具關卡與軌跡（誰於何時送出、誰於何時核可／退回）。
 * - 前段產出（報價單、客製需求文件等）可帶往後續步驟引用。
 *
 * 本檔僅負責「決策／驗證」：給定表單定義、掛載關係與既有填寫資料，
 * 算出「資料是否合法」「送出／簽核應如何轉換」「步驟必填表單是否齊備」
 * 以及「後續步驟可帶出哪些前段產出」。
 * 真正的資料庫寫入由 FormsService 依計畫（plan）執行，使核心可被純函式單元測試覆蓋。
 */

/** 表單欄位最小欄位（對應 Prisma FormField）。 */
export interface EngineFormField {
  id?: string;
  order: number;
  key: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  /** SELECT / MULTISELECT 的選項；接受 string[] 或 {value,label}[]。 */
  options?: unknown;
}

/** 表單定義最小欄位（對應 Prisma FormDefinition）。 */
export interface EngineFormDefinition {
  id: string;
  code: string;
  name: string;
  version?: number;
  /** 是否為簽核類表單（具核可關卡與軌跡）。 */
  isSignable: boolean;
  fields: EngineFormField[];
}

/** 步驟↔表單掛載（對應 Prisma StepForm）。 */
export interface EngineStepForm {
  stepId: string;
  formId: string;
  isRequired: boolean;
}

/** 表單填寫實例最小欄位（對應 Prisma FormSubmission）。 */
export interface EngineFormSubmission {
  id: string;
  formDefinitionId: string;
  /** 該填寫所屬的步驟實例（用於判斷「前段／後續」先後順序）。 */
  stepInstanceId: string | null;
  /** 該步驟實例的 order；用於跨步驟先後比較（後續步驟引用前段產出）。 */
  stepOrder?: number | null;
  status: SubmissionStatus;
  data: Record<string, unknown>;
  submittedById?: string | null;
  approvedById?: string | null;
  createdAt?: Date;
}

export type FormsEngineErrorCode =
  | 'duplicate_field_key'
  | 'duplicate_field_order'
  | 'missing_select_options'
  | 'form_field_mismatch'
  | 'validation_failed'
  | 'submission_not_submitted'
  | 'form_not_signable'
  | 'already_finalized'
  | 'form_mismatch';

/** 引擎錯誤；以 code 表示原因，方便上層轉成對應 HTTP 例外或訊息。 */
export class FormsEngineError extends Error {
  constructor(
    public readonly code: FormsEngineErrorCode,
    message?: string,
    /** 欄位層級錯誤（驗證失敗時帶出）。 */
    public readonly fieldErrors?: FieldError[],
  ) {
    super(message ?? code);
    this.name = 'FormsEngineError';
  }
}

/** 單一欄位驗證錯誤。 */
export interface FieldError {
  key: string;
  code:
    | 'required'
    | 'not_a_number'
    | 'invalid_date'
    | 'not_in_options'
    | 'not_a_list'
    | 'option_not_allowed'
    | 'not_a_boolean';
}

/** 依 order 由小到大排序（不改動原陣列）。 */
export function sortByOrder<T extends { order: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order);
}

/**
 * 驗證表單定義是否合法。
 * - 欄位 key 不可重複、order 不可重複。
 * - SELECT / MULTISELECT 必須提供至少一個選項。
 * 回傳錯誤代碼陣列（空陣列代表合法）。
 */
export function validateFormDefinition(
  fields: readonly EngineFormField[],
): FormsEngineErrorCode[] {
  const errors: FormsEngineErrorCode[] = [];
  const keys = new Set<string>();
  const orders = new Set<number>();
  for (const f of fields) {
    if (keys.has(f.key)) {
      errors.push('duplicate_field_key');
      break;
    }
    keys.add(f.key);
  }
  for (const f of fields) {
    if (orders.has(f.order)) {
      errors.push('duplicate_field_order');
      break;
    }
    orders.add(f.order);
  }
  for (const f of fields) {
    if (
      (f.fieldType === FieldType.SELECT || f.fieldType === FieldType.MULTISELECT) &&
      allowedOptionValues(f.options).length === 0
    ) {
      errors.push('missing_select_options');
      break;
    }
  }
  return errors;
}

/** 驗證表單定義，不合法則丟出 FormsEngineError。 */
export function assertValidFormDefinition(fields: readonly EngineFormField[]): void {
  const errors = validateFormDefinition(fields);
  if (errors.length > 0) {
    throw new FormsEngineError(errors[0]);
  }
}

/** 從 options（string[] 或 {value}[]）抽出允許值（字串）。 */
export function allowedOptionValues(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  const out: string[] = [];
  for (const o of options) {
    if (typeof o === 'string' || typeof o === 'number') {
      out.push(String(o));
    } else if (o && typeof o === 'object' && 'value' in (o as Record<string, unknown>)) {
      out.push(String((o as Record<string, unknown>).value));
    }
  }
  return out;
}

/**
 * 依欄位定義驗證一筆填寫資料。
 * - 必填欄位需有值（FILE / SIGNATURE 也視為一般必填值）。
 * - NUMBER 必須可轉為有限數字；DATE 必須可被 Date 解析。
 * - SELECT 值必須在選項內；MULTISELECT 必須為陣列且每個值都在選項內。
 * - CHECKBOX 必須為布林。
 * 回傳 FieldError 陣列（空陣列代表通過）。未在定義中的多餘 key 會被忽略。
 */
export function validateFieldValues(
  fields: readonly EngineFormField[],
  data: Record<string, unknown>,
): FieldError[] {
  const errors: FieldError[] = [];
  for (const f of fields) {
    const raw = data[f.key];
    const empty = isEmpty(raw);

    if (empty) {
      if (f.required) errors.push({ key: f.key, code: 'required' });
      continue; // 空值（非必填）不再做型別檢查
    }

    switch (f.fieldType) {
      case FieldType.NUMBER: {
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(n)) errors.push({ key: f.key, code: 'not_a_number' });
        break;
      }
      case FieldType.DATE: {
        const t = raw instanceof Date ? raw.getTime() : Date.parse(String(raw));
        if (Number.isNaN(t)) errors.push({ key: f.key, code: 'invalid_date' });
        break;
      }
      case FieldType.SELECT: {
        const allowed = allowedOptionValues(f.options);
        if (!allowed.includes(String(raw))) {
          errors.push({ key: f.key, code: 'not_in_options' });
        }
        break;
      }
      case FieldType.MULTISELECT: {
        if (!Array.isArray(raw)) {
          errors.push({ key: f.key, code: 'not_a_list' });
          break;
        }
        const allowed = allowedOptionValues(f.options);
        if (raw.some((v) => !allowed.includes(String(v)))) {
          errors.push({ key: f.key, code: 'option_not_allowed' });
        }
        break;
      }
      case FieldType.CHECKBOX: {
        if (typeof raw !== 'boolean') errors.push({ key: f.key, code: 'not_a_boolean' });
        break;
      }
      default:
        // TEXT / TEXTAREA / FILE / SIGNATURE：有值即可
        break;
    }
  }
  return errors;
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** 送出計畫（提交一筆填寫）。 */
export interface SubmitPlan {
  formDefinitionId: string;
  status: SubmissionStatus;
  data: Record<string, unknown>;
  submittedById: string | null;
  submittedAt: Date;
}

/**
 * 計算「送出表單填寫」的計畫。
 * - 先驗證資料；不合法丟出 FormsEngineError('validation_failed')（含欄位錯誤）。
 * - 合法則回傳狀態 SUBMITTED 與送出人／時間。
 */
export function planSubmit(
  form: EngineFormDefinition,
  data: Record<string, unknown>,
  submittedById: string | null,
  now: Date = new Date(),
): SubmitPlan {
  const errors = validateFieldValues(form.fields, data);
  if (errors.length > 0) {
    throw new FormsEngineError('validation_failed', 'validation_failed', errors);
  }
  return {
    formDefinitionId: form.id,
    status: SubmissionStatus.SUBMITTED,
    data,
    submittedById,
    submittedAt: now,
  };
}

/** 簽核計畫（核可／退回）。 */
export interface SignPlan {
  submissionId: string;
  status: SubmissionStatus; // APPROVED | REJECTED
  approvedById: string | null;
  approvedAt: Date;
}

function assertSignable(form: EngineFormDefinition, submission: EngineFormSubmission): void {
  if (form.id !== submission.formDefinitionId) {
    throw new FormsEngineError('form_mismatch');
  }
  if (!form.isSignable) {
    throw new FormsEngineError('form_not_signable');
  }
  if (submission.status !== SubmissionStatus.SUBMITTED) {
    if (
      submission.status === SubmissionStatus.APPROVED ||
      submission.status === SubmissionStatus.REJECTED
    ) {
      throw new FormsEngineError('already_finalized');
    }
    throw new FormsEngineError('submission_not_submitted');
  }
}

/**
 * 計算「核可」計畫（簽核軌跡）。
 * - 表單必須為簽核類（isSignable）。
 * - 填寫必須已送出（SUBMITTED），否則不可核可。
 * - 記錄核可人與時間（誰於何時核可）。
 */
export function planApprove(
  form: EngineFormDefinition,
  submission: EngineFormSubmission,
  approverId: string | null,
  now: Date = new Date(),
): SignPlan {
  assertSignable(form, submission);
  return {
    submissionId: submission.id,
    status: SubmissionStatus.APPROVED,
    approvedById: approverId,
    approvedAt: now,
  };
}

/** 計算「退回」計畫（簽核軌跡）。規則同核可，狀態為 REJECTED。 */
export function planReject(
  form: EngineFormDefinition,
  submission: EngineFormSubmission,
  approverId: string | null,
  now: Date = new Date(),
): SignPlan {
  assertSignable(form, submission);
  return {
    submissionId: submission.id,
    status: SubmissionStatus.REJECTED,
    approvedById: approverId,
    approvedAt: now,
  };
}

/**
 * 判斷某步驟的「必填表單」是否齊備（供 2.1 引擎於 advance 前把關）。
 * 規則：
 * - 取該步驟掛載且 isRequired 的表單。
 * - 一般表單：該步驟實例需有一筆 status 為 SUBMITTED 或 APPROVED 的填寫。
 * - 簽核類表單（signableFormIds 內）：必須是 APPROVED 才算齊備。
 * 回傳尚未齊備的 formId 陣列（空陣列代表可推進）。
 */
export function unmetRequiredForms(
  stepForms: readonly EngineStepForm[],
  submissions: readonly EngineFormSubmission[],
  stepId: string,
  stepInstanceId: string,
  signableFormIds: ReadonlySet<string> = new Set(),
): string[] {
  const required = stepForms.filter((sf) => sf.stepId === stepId && sf.isRequired);
  const unmet: string[] = [];
  for (const sf of required) {
    const subs = submissions.filter(
      (s) => s.formDefinitionId === sf.formId && s.stepInstanceId === stepInstanceId,
    );
    const ok = subs.some((s) =>
      signableFormIds.has(sf.formId)
        ? s.status === SubmissionStatus.APPROVED
        : s.status === SubmissionStatus.SUBMITTED || s.status === SubmissionStatus.APPROVED,
    );
    if (!ok) unmet.push(sf.formId);
  }
  return unmet;
}

/** 便利布林版：必填表單是否全部齊備。 */
export function requiredFormsSatisfied(
  stepForms: readonly EngineStepForm[],
  submissions: readonly EngineFormSubmission[],
  stepId: string,
  stepInstanceId: string,
  signableFormIds: ReadonlySet<string> = new Set(),
): boolean {
  return (
    unmetRequiredForms(stepForms, submissions, stepId, stepInstanceId, signableFormIds)
      .length === 0
  );
}

/** 跨步驟引用設定：把前段某表單的某欄位帶入後續表單的某欄位。 */
export interface FieldReference {
  /** 來源表單定義 id。 */
  sourceFormId: string;
  /** 來源欄位 key。 */
  sourceKey: string;
  /** 帶入目標欄位 key。 */
  targetKey: string;
}

/** 帶出結果中的單一引用值（含可追溯來源）。 */
export interface ResolvedReference {
  targetKey: string;
  value: unknown;
  sourceFormId: string;
  sourceKey: string;
  sourceSubmissionId: string;
}

/**
 * 解析後續步驟可帶出的前段產出（報價單／客製需求文件 → 後續引用）。
 * - 只採用「目前步驟之前」（stepOrder 較小）且已 SUBMITTED / APPROVED 的填寫。
 * - 同一來源表單若有多筆，取最新一筆（stepOrder 較大者；同 order 取 createdAt 較新）。
 * - 回傳每個 reference 對應的帶出值；找不到來源的 reference 會被略過。
 */
export function resolveReferences(
  references: readonly FieldReference[],
  priorSubmissions: readonly EngineFormSubmission[],
  currentStepOrder: number,
): ResolvedReference[] {
  const usable = priorSubmissions.filter(
    (s) =>
      (s.status === SubmissionStatus.SUBMITTED || s.status === SubmissionStatus.APPROVED) &&
      (s.stepOrder ?? -Infinity) < currentStepOrder,
  );

  const latestByForm = new Map<string, EngineFormSubmission>();
  for (const s of usable) {
    const prev = latestByForm.get(s.formDefinitionId);
    if (!prev || isNewer(s, prev)) latestByForm.set(s.formDefinitionId, s);
  }

  const resolved: ResolvedReference[] = [];
  for (const ref of references) {
    const src = latestByForm.get(ref.sourceFormId);
    if (!src) continue;
    if (!(ref.sourceKey in src.data)) continue;
    resolved.push({
      targetKey: ref.targetKey,
      value: src.data[ref.sourceKey],
      sourceFormId: ref.sourceFormId,
      sourceKey: ref.sourceKey,
      sourceSubmissionId: src.id,
    });
  }
  return resolved;
}

function isNewer(a: EngineFormSubmission, b: EngineFormSubmission): boolean {
  const ao = a.stepOrder ?? -Infinity;
  const bo = b.stepOrder ?? -Infinity;
  if (ao !== bo) return ao > bo;
  const at = a.createdAt?.getTime() ?? 0;
  const bt = b.createdAt?.getTime() ?? 0;
  return at >= bt;
}

/**
 * 將解析出的引用值套成「預填資料」物件（targetKey → value），
 * 供後續表單初始化時帶入。
 */
export function toPrefillData(resolved: readonly ResolvedReference[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of resolved) out[r.targetKey] = r.value;
  return out;
}
