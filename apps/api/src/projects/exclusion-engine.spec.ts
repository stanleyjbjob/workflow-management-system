import {
  ExclusionEngineError,
  EXCLUSION_SOURCES,
  buildExclusionDraft,
  buildExclusionPatch,
  normalizeSource,
  isDateExcluded,
  exclusionCalendarDays,
  toIsoDate,
  type NormalizedExclusion,
} from './exclusion-engine';

describe('exclusion-engine（5.4 專案行事曆排除日）', () => {
  describe('buildExclusionDraft', () => {
    it('正規化合法輸入：日期轉 UTC 午夜、reason 去空白、source 透傳', () => {
      const e = buildExclusionDraft({
        fromDate: '2026-02-10',
        toDate: '2026-02-12',
        reason: '  客戶系統凍結  ',
        source: 'CUSTOMER',
      });
      expect(toIsoDate(e.fromDate)).toBe('2026-02-10');
      expect(toIsoDate(e.toDate)).toBe('2026-02-12');
      expect(e.fromDate.getUTCHours()).toBe(0);
      expect(e.toDate.getUTCHours()).toBe(0);
      expect(e.reason).toBe('客戶系統凍結');
      expect(e.source).toBe('CUSTOMER');
    });

    it('允許單日排除（from === to）', () => {
      const e = buildExclusionDraft({ fromDate: '2026-03-01', toDate: '2026-03-01', reason: '盤點' });
      expect(toIsoDate(e.fromDate)).toBe(toIsoDate(e.toDate));
      expect(e.source).toBeNull();
    });

    it('接受 Date 物件輸入', () => {
      const e = buildExclusionDraft({
        fromDate: new Date(Date.UTC(2026, 4, 1)),
        toDate: new Date(Date.UTC(2026, 4, 3)),
        reason: '客戶休假',
        source: 'INTERNAL',
      });
      expect(toIsoDate(e.fromDate)).toBe('2026-05-01');
      expect(e.source).toBe('INTERNAL');
    });

    it('fromDate 缺漏 → from_required', () => {
      expect(() => buildExclusionDraft({ toDate: '2026-02-12', reason: 'x' })).toThrow(ExclusionEngineError);
      try {
        buildExclusionDraft({ toDate: '2026-02-12', reason: 'x' });
      } catch (err) {
        expect((err as ExclusionEngineError).code).toBe('from_required');
      }
    });

    it('toDate 缺漏 → to_required', () => {
      try {
        buildExclusionDraft({ fromDate: '2026-02-12', reason: 'x' });
      } catch (err) {
        expect((err as ExclusionEngineError).code).toBe('to_required');
      }
    });

    it('toDate 早於 fromDate → invalid_range', () => {
      try {
        buildExclusionDraft({ fromDate: '2026-02-12', toDate: '2026-02-10', reason: 'x' });
      } catch (err) {
        expect((err as ExclusionEngineError).code).toBe('invalid_range');
      }
    });

    it('非法日期 → invalid_date', () => {
      try {
        buildExclusionDraft({ fromDate: 'not-a-date', toDate: '2026-02-10', reason: 'x' });
      } catch (err) {
        expect((err as ExclusionEngineError).code).toBe('invalid_date');
      }
    });

    it('reason 空白 → reason_required', () => {
      try {
        buildExclusionDraft({ fromDate: '2026-02-10', toDate: '2026-02-12', reason: '   ' });
      } catch (err) {
        expect((err as ExclusionEngineError).code).toBe('reason_required');
      }
    });

    it('未知 source → invalid_source', () => {
      try {
        buildExclusionDraft({ fromDate: '2026-02-10', toDate: '2026-02-12', reason: 'x', source: 'OTHER' });
      } catch (err) {
        expect((err as ExclusionEngineError).code).toBe('invalid_source');
      }
    });
  });

  describe('normalizeSource', () => {
    it('空值 / 空字串 → null', () => {
      expect(normalizeSource(undefined)).toBeNull();
      expect(normalizeSource(null)).toBeNull();
      expect(normalizeSource('  ')).toBeNull();
    });
    it('合法值透傳', () => {
      for (const s of EXCLUSION_SOURCES) expect(normalizeSource(s)).toBe(s);
    });
    it('非法值拋錯', () => {
      expect(() => normalizeSource('FOO')).toThrow(ExclusionEngineError);
    });
  });

  describe('buildExclusionPatch', () => {
    const current: NormalizedExclusion = {
      fromDate: new Date(Date.UTC(2026, 1, 10)),
      toDate: new Date(Date.UTC(2026, 1, 12)),
      reason: '原因A',
      source: 'CUSTOMER',
    };

    it('未提供欄位沿用 current', () => {
      const e = buildExclusionPatch({ reason: '原因B' }, current);
      expect(toIsoDate(e.fromDate)).toBe('2026-02-10');
      expect(toIsoDate(e.toDate)).toBe('2026-02-12');
      expect(e.reason).toBe('原因B');
      expect(e.source).toBe('CUSTOMER');
    });

    it('source 傳 null → 明確清除', () => {
      const e = buildExclusionPatch({ source: null }, current);
      expect(e.source).toBeNull();
    });

    it('跨欄位仍驗證 from<=to（改 toDate 早於既有 fromDate 應拋錯）', () => {
      expect(() => buildExclusionPatch({ toDate: '2026-02-01' }, current)).toThrow(ExclusionEngineError);
    });
  });

  describe('isDateExcluded（時程避開該區間）', () => {
    const ex = [
      { fromDate: new Date(Date.UTC(2026, 1, 10)), toDate: new Date(Date.UTC(2026, 1, 12)) },
    ];
    it('區間內（含端點）為 true', () => {
      expect(isDateExcluded(new Date(Date.UTC(2026, 1, 10)), ex)).toBe(true);
      expect(isDateExcluded(new Date(Date.UTC(2026, 1, 11)), ex)).toBe(true);
      expect(isDateExcluded(new Date(Date.UTC(2026, 1, 12)), ex)).toBe(true);
    });
    it('區間外為 false', () => {
      expect(isDateExcluded(new Date(Date.UTC(2026, 1, 9)), ex)).toBe(false);
      expect(isDateExcluded(new Date(Date.UTC(2026, 1, 13)), ex)).toBe(false);
    });
    it('空清單恆 false', () => {
      expect(isDateExcluded(new Date(Date.UTC(2026, 1, 11)), [])).toBe(false);
    });
  });

  describe('exclusionCalendarDays', () => {
    it('單日為 1', () => {
      expect(
        exclusionCalendarDays({ fromDate: new Date(Date.UTC(2026, 2, 1)), toDate: new Date(Date.UTC(2026, 2, 1)) }),
      ).toBe(1);
    });
    it('含端點計數', () => {
      expect(
        exclusionCalendarDays({ fromDate: new Date(Date.UTC(2026, 1, 10)), toDate: new Date(Date.UTC(2026, 1, 12)) }),
      ).toBe(3);
    });
  });
});
