/**
 * 稽核軌跡查閱頁純呈現邏輯（§11 / issue 8.3 #35）。
 * 無 fetch / DOM / React 相依，可被 vitest 直接測試；所有函式皆純讀取、不變動輸入。
 */
import type { TraceSignStatus, TraceabilityRecord, TrailSummary } from './types';

/** 簽核狀態徽章中繼資料（label + prototype pill 色票 class）。 */
export interface SignStatusMeta {
  label: string;
  pill: string;
}

const SIGN_STATUS_META: Readonly<Record<TraceSignStatus, SignStatusMeta>> = {
  NONE: { label: '無需簽核', pill: 'p-grey' },
  DRAFT: { label: '草稿', pill: 'p-grey' },
  SUBMITTED: { label: '待簽核', pill: 'p-amber' },
  APPROVED: { label: '已核可', pill: 'p-green' },
  REJECTED: { label: '已退回', pill: 'p-red' },
};

export function signStatusMeta(status: TraceSignStatus): SignStatusMeta {
  return SIGN_STATUS_META[status] ?? SIGN_STATUS_META.NONE;
}

/** 留存期限顯示：政策未注入（null）→「不限／未定」（issue 補充）；可解析日期 → YYYY-MM-DD。 */
export function retentionLabel(retentionUntil: string | null): string {
  if (retentionUntil == null) return '不限／未定';
  const t = Date.parse(retentionUntil);
  if (Number.isNaN(t)) return '不限／未定';
  return new Date(t).toISOString().slice(0, 10);
}

/** ISO 字串 → 「YYYY-MM-DD HH:mm」（UTC，穩定可測）；無法解析時原樣回傳。 */
export function formatDateTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toISOString().slice(0, 16).replace('T', ' ');
}

/** KPI 卡（沿用 task-kanban grid-kpi 樣式）。 */
export interface TrailKpiCard {
  key: 'total' | 'signable' | 'pendingSignature' | 'expiredRetention';
  label: string;
  value: number;
  color: string;
  pct: number;
}

function ratioPct(value: number, total: number): number {
  if (total <= 0 || value <= 0) return 6;
  return Math.max(6, Math.min(100, Math.round((value / total) * 100)));
}

/** 由彙總統計推導 KPI 卡：總數 / 需簽核 / 簽核缺口 / 留存到期。 */
export function buildSummaryCards(summary: TrailSummary): TrailKpiCard[] {
  return [
    { key: 'total', label: '可稽核紀錄', value: summary.total, color: 'var(--brand)', pct: summary.total > 0 ? 100 : 6 },
    {
      key: 'signable',
      label: '需簽核文件',
      value: summary.signableCount,
      color: 'var(--purple)',
      pct: ratioPct(summary.signableCount, summary.total),
    },
    {
      key: 'pendingSignature',
      label: '簽核缺口',
      value: summary.pendingSignatureCount,
      color: summary.pendingSignatureCount > 0 ? 'var(--red)' : 'var(--green)',
      pct: ratioPct(summary.pendingSignatureCount, summary.signableCount),
    },
    {
      key: 'expiredRetention',
      label: '留存已到期',
      value: summary.expiredRetentionCount,
      color: summary.expiredRetentionCount > 0 ? 'var(--amber)' : 'var(--green)',
      pct: ratioPct(summary.expiredRetentionCount, summary.total),
    },
  ];
}

/** ISO 面向分布（依筆數遞減、同數依名稱遞增；取前 limit 名）。 */
export function topAspects(byAspect: Record<string, number>, limit = 6): { aspect: string; count: number }[] {
  return Object.entries(byAspect)
    .map(([aspect, count]) => ({ aspect, count }))
    .sort((a, b) => b.count - a.count || a.aspect.localeCompare(b.aspect))
    .slice(0, Math.max(0, limit));
}

/** 列表唯一 key（recordId 僅在同類別內唯一）。 */
export function recordKey(r: Pick<TraceabilityRecord, 'recordType' | 'recordId'>): string {
  return r.recordType + ':' + r.recordId;
}

/** 依發生時間遞減排序（回傳複本，不變動輸入；無法解析的日期排最後）。 */
export function sortTrail(records: readonly TraceabilityRecord[]): TraceabilityRecord[] {
  const ts = (r: TraceabilityRecord): number => {
    const t = Date.parse(r.occurredAt);
    return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
  };
  return [...records].sort((a, b) => ts(b) - ts(a));
}

/** 簽核過濾選項（UI 單選 → 後端 requiresSignatureOnly / signedOff 參數組合）。 */
export type SignFilter = '' | 'signable' | 'gap' | 'signed';

export const SIGN_FILTER_OPTIONS: ReadonlyArray<{ value: SignFilter; label: string }> = [
  { value: '', label: '全部' },
  { value: 'signable', label: '需簽核' },
  { value: 'gap', label: '簽核缺口' },
  { value: 'signed', label: '已核可' },
];

/** SignFilter → 查詢參數（純函式；'' 不過濾）。 */
export function signFilterToQuery(sign: SignFilter): { requiresSignatureOnly?: boolean; signedOff?: boolean } {
  switch (sign) {
    case 'signable':
      return { requiresSignatureOnly: true };
    case 'gap':
      return { requiresSignatureOnly: true, signedOff: false };
    case 'signed':
      return { signedOff: true };
    default:
      return {};
  }
}
