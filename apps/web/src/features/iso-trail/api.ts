/**
 * 稽核軌跡 REST 串接（issue 8.3 #35；後端 iso-trail.controller.ts，issue 6.2 / 8.1）。
 * 查詢參數組裝（trailQuery / exportQuery）為純函式，可被 vitest 測試；
 * 後端已依登入者可見範圍收斂（IsoTrailService + AccessScopeService），前端取回即用。
 */
import { API_BASE, apiGet, buildQuery } from '../../lib/api';
import type { SignFilter } from './trail-view';
import { signFilterToQuery } from './trail-view';
import type { TraceabilityRecord, TrailSummary } from './types';

/** `GET /iso-trail` 查詢參數（對應 iso-trail.controller.ts buildFilter）。 */
export interface TrailQuery {
  /** 紀錄類別（多值以逗號分隔，如 `FORM_SUBMISSION,ATTACHMENT`）。 */
  recordType?: string | null;
  /** 文件種類（多值以逗號分隔）。 */
  documentKind?: string | null;
  caseId?: string | null;
  projectId?: string | null;
  /** 起日（YYYY-MM-DD 或 ISO 字串）。 */
  from?: string | null;
  /** 迄日。 */
  to?: string | null;
  /** 僅顯示需簽核者。 */
  requiresSignatureOnly?: boolean;
  /** 簽核完成與否（undefined/null = 全部）。 */
  signedOff?: boolean | null;
}

/** 組 /iso-trail 查詢字串（純函式）。 */
export function trailQuery(q: TrailQuery = {}): string {
  return buildQuery({
    recordType: q.recordType,
    documentKind: q.documentKind,
    caseId: q.caseId,
    projectId: q.projectId,
    from: q.from,
    to: q.to,
    requiresSignatureOnly: q.requiresSignatureOnly ? true : undefined,
    signedOff: q.signedOff == null ? undefined : q.signedOff,
  });
}

/**
 * 組 summary / export 查詢字串（純函式）。
 * 後端 summary / export(.csv) 僅支援 recordType / documentKind / caseId / projectId 四項過濾，
 * 故僅帶這四項（日期與簽核過濾不在匯出端點上）。
 */
export function exportQuery(q: TrailQuery = {}): string {
  return buildQuery({
    recordType: q.recordType,
    documentKind: q.documentKind,
    caseId: q.caseId,
    projectId: q.projectId,
  });
}

/** UI 過濾狀態（View / Page 共用）。 */
export interface TrailFilterState {
  recordType: string;
  documentKind: string;
  caseId: string;
  projectId: string;
  from: string;
  to: string;
  sign: SignFilter;
}

export const EMPTY_TRAIL_FILTER: TrailFilterState = {
  recordType: '',
  documentKind: '',
  caseId: '',
  projectId: '',
  from: '',
  to: '',
  sign: '',
};

/** UI 過濾狀態 → TrailQuery（純函式；空字串視為未過濾）。 */
export function filterToQuery(f: TrailFilterState): TrailQuery {
  return {
    recordType: f.recordType || null,
    documentKind: f.documentKind || null,
    caseId: f.caseId.trim() || null,
    projectId: f.projectId.trim() || null,
    from: f.from || null,
    to: f.to || null,
    ...signFilterToQuery(f.sign),
  };
}

/** 取得稽核軌跡列表。 */
export function fetchTrail(q: TrailQuery = {}): Promise<TraceabilityRecord[]> {
  return apiGet<TraceabilityRecord[]>(`/iso-trail${trailQuery(q)}`);
}

/** 取得彙總統計。 */
export function fetchTrailSummary(q: TrailQuery = {}): Promise<TrailSummary> {
  return apiGet<TrailSummary>(`/iso-trail/summary${exportQuery(q)}`);
}

/** 完整稽核匯出包（JSON）下載連結（session cookie 認證，直接以 <a href> 下載）。 */
export function exportJsonUrl(q: TrailQuery = {}): string {
  return `${API_BASE}/iso-trail/export${exportQuery(q)}`;
}

/** 稽核紀錄 CSV 下載連結。 */
export function exportCsvUrl(q: TrailQuery = {}): string {
  return `${API_BASE}/iso-trail/export.csv${exportQuery(q)}`;
}
