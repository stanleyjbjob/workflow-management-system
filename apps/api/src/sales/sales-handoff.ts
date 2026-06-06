import { CaseStatus } from '@prisma/client';
import { HandoffPayload, SalesDoc, SalesDocKind } from './sales-engine';

/**
 * 成案移交藍圖的「持久化序列化」與還原（純領域邏輯，無 DB 相依）。
 *
 * 對應需求規格 §4.6「成案產出自動帶往導入」：成案（markWon）時，把
 * sales-engine.planWin 算出的 HandoffPayload 以 append-only 的 FormSubmission
 * 落地，使移交內容 durable——後續導入 / 客製化流程可據此引用已帶往的產出，
 * 而非僅在記憶體回傳後即遺失。沿用既有 forms 持久化機制，本輪不新增 migration。
 *
 * 說明：本檔與 sales-engine.ts 同層、由 index.ts re-export。獨立成檔以聚焦
 * 「移交落地」一事；review 時可決定是否併回 sales-engine.ts。
 */

/** 承載成案移交藍圖落地的表單代碼（FormDefinition.code）。 */
export const SALES_HANDOFF_FORM_CODE = 'SALES_HANDOFF';

/** 移交還原失敗的錯誤（毀損 / 不合法資料）。 */
export class SalesHandoffError extends Error {
  constructor(
    public readonly code: 'handoff_corrupt',
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'SalesHandoffError';
  }
}

/** HandoffPayload 的可序列化（JSON-safe）表達，存入 FormSubmission.data。 */
export interface HandoffData {
  caseStatus: CaseStatus;
  finalQuote: SalesDoc;
  customRequirement: SalesDoc | null;
  carriedDocRefIds: string[];
}

/** 判斷一個值是否為結構合法的 SalesDoc（供還原時把關）。 */
function isSalesDoc(v: unknown): v is SalesDoc {
  if (!v || typeof v !== 'object') return false;
  const d = v as Partial<SalesDoc>;
  return (
    (d.kind === SalesDocKind.QUOTE || d.kind === SalesDocKind.CUSTOM_REQUIREMENT) &&
    typeof d.refId === 'string' &&
    d.refId.length > 0 &&
    typeof d.name === 'string' &&
    typeof d.version === 'number'
  );
}

/** 將移交藍圖轉為 JSON-safe 物件（淺拷貝產出引用）。 */
export function serializeHandoff(payload: HandoffPayload): HandoffData {
  return {
    caseStatus: payload.caseStatus,
    finalQuote: { ...payload.finalQuote },
    customRequirement: payload.customRequirement ? { ...payload.customRequirement } : null,
    carriedDocRefIds: [...payload.carriedDocRefIds],
  };
}

/**
 * 將持久化的 JSON 物件還原為移交藍圖。
 * 對毀損 / 不合法資料丟出 SalesHandoffError('handoff_corrupt')，避免污染下游引用。
 */
export function deserializeHandoff(data: unknown): HandoffData {
  if (!data || typeof data !== 'object') throw new SalesHandoffError('handoff_corrupt');
  const d = data as Partial<HandoffData>;
  if (!isSalesDoc(d.finalQuote)) throw new SalesHandoffError('handoff_corrupt');
  if (d.customRequirement != null && !isSalesDoc(d.customRequirement))
    throw new SalesHandoffError('handoff_corrupt');
  const carried = Array.isArray(d.carriedDocRefIds)
    ? d.carriedDocRefIds.filter((x): x is string => typeof x === 'string')
    : [];
  return {
    caseStatus: d.caseStatus ?? CaseStatus.COMPLETED,
    finalQuote: { ...(d.finalQuote as SalesDoc) },
    customRequirement: d.customRequirement ? { ...(d.customRequirement as SalesDoc) } : null,
    carriedDocRefIds: carried,
  };
}
