/** 稽核軌跡純呈現邏輯測試（issue 8.3 #35）。 */
import { describe, expect, it } from 'vitest';
import {
  buildSummaryCards,
  formatDateTime,
  recordKey,
  retentionLabel,
  signFilterToQuery,
  signStatusMeta,
  sortTrail,
  topAspects,
} from './trail-view';
import { sampleTrailRecords, sampleTrailSummary } from './seed';
import type { TrailSummary } from './types';

describe('retentionLabel', () => {
  it('null（留存政策未注入）→ 不限／未定（issue 補充）', () => {
    expect(retentionLabel(null)).toBe('不限／未定');
  });

  it('可解析日期 → YYYY-MM-DD；無法解析 → 不限／未定', () => {
    expect(retentionLabel('2033-05-13T06:00:00.000Z')).toBe('2033-05-13');
    expect(retentionLabel('not-a-date')).toBe('不限／未定');
  });
});

describe('formatDateTime', () => {
  it('ISO 字串 → YYYY-MM-DD HH:mm（UTC）；無法解析原樣回傳', () => {
    expect(formatDateTime('2026-06-01T02:30:00.000Z')).toBe('2026-06-01 02:30');
    expect(formatDateTime('garbage')).toBe('garbage');
  });
});

describe('signStatusMeta', () => {
  it('五態標籤與色票', () => {
    expect(signStatusMeta('APPROVED')).toEqual({ label: '已核可', pill: 'p-green' });
    expect(signStatusMeta('SUBMITTED').pill).toBe('p-amber');
    expect(signStatusMeta('REJECTED').pill).toBe('p-red');
    expect(signStatusMeta('NONE').label).toBe('無需簽核');
  });
});

describe('signFilterToQuery', () => {
  it('四分支映射', () => {
    expect(signFilterToQuery('')).toEqual({});
    expect(signFilterToQuery('signable')).toEqual({ requiresSignatureOnly: true });
    expect(signFilterToQuery('gap')).toEqual({ requiresSignatureOnly: true, signedOff: false });
    expect(signFilterToQuery('signed')).toEqual({ signedOff: true });
  });
});

describe('buildSummaryCards', () => {
  it('四張卡：總數 / 需簽核 / 簽核缺口 / 留存到期，值與彙總一致', () => {
    const cards = buildSummaryCards(sampleTrailSummary);
    expect(cards.map((c) => c.key)).toEqual(['total', 'signable', 'pendingSignature', 'expiredRetention']);
    expect(cards[0].value).toBe(4);
    expect(cards[2].value).toBe(1);
    for (const c of cards) {
      expect(c.pct).toBeGreaterThanOrEqual(6);
      expect(c.pct).toBeLessThanOrEqual(100);
    }
  });

  it('簽核缺口 > 0 顯示警示色；全零彙總不出 NaN', () => {
    expect(buildSummaryCards(sampleTrailSummary)[2].color).toBe('var(--red)');
    const empty: TrailSummary = {
      total: 0,
      byType: {},
      byAspect: {},
      signableCount: 0,
      signedCount: 0,
      pendingSignatureCount: 0,
      expiredRetentionCount: 0,
    };
    const cards = buildSummaryCards(empty);
    expect(cards[2].color).toBe('var(--green)');
    for (const c of cards) expect(Number.isFinite(c.pct)).toBe(true);
  });
});

describe('topAspects', () => {
  it('依筆數遞減、同數依名稱遞增、取前 N', () => {
    const got = topAspects({ b: 2, a: 2, c: 5, d: 1 }, 3);
    expect(got).toEqual([
      { aspect: 'c', count: 5 },
      { aspect: 'a', count: 2 },
      { aspect: 'b', count: 2 },
    ]);
  });
});

describe('sortTrail / recordKey', () => {
  it('依發生時間遞減且不變動輸入', () => {
    const input = [...sampleTrailRecords];
    const before = JSON.stringify(input);
    const sorted = sortTrail(input);
    expect(sorted[0].recordId).toBe('login-555');
    expect(sorted[sorted.length - 1].recordId).toBe('fs-001');
    expect(JSON.stringify(input)).toBe(before);
  });

  it('recordKey 以類別+id 組合（recordId 僅同類別內唯一）', () => {
    expect(recordKey({ recordType: 'LOGIN', recordId: 'x' })).toBe('LOGIN:x');
  });
});
