import {
  detectExclusionConflicts,
  hasAnyExclusionConflict,
  FlowIntervalInput,
  ExclusionRangeInput,
} from './exclusion-conflict';
import { ExclusionEngineError } from './exclusion-engine';

/**
 * exclusion-conflict 純引擎單元測試（issue 5.4 / #26，§9-6 A 案：偵測重疊、回報警示、不自動順延）。
 * 日界一律 UTC、重疊含端點。
 */

const iso = (d: Date) => d.toISOString().slice(0, 10);

const FLOW_A: FlowIntervalInput = {
  flowId: 'A',
  name: '導入',
  flowType: 'ONBOARDING',
  planStart: '2026-02-16',
  planEnd: '2026-02-25',
};

describe('exclusion-conflict', () => {
  describe('detectExclusionConflicts', () => {
    it('基本：只回報落入流程區間的排除日，含正確重疊區間與天數', () => {
      const exclusions: ExclusionRangeInput[] = [
        { exclusionId: 'E1', fromDate: '2026-02-18', toDate: '2026-02-20', reason: '客戶教育訓練', source: 'CUSTOMER' },
        { exclusionId: 'E2', fromDate: '2026-03-01', toDate: '2026-03-03' }, // 區間外
      ];
      const r = detectExclusionConflicts([FLOW_A], exclusions);

      expect(r).toHaveLength(1);
      expect(r[0].flowId).toBe('A');
      expect(r[0].conflicts).toHaveLength(1);
      const c = r[0].conflicts[0];
      expect(c.exclusionId).toBe('E1');
      expect(iso(c.overlapFrom)).toBe('2026-02-18');
      expect(iso(c.overlapTo)).toBe('2026-02-20');
      expect(c.overlapCalendarDays).toBe(3);
      expect(c.reason).toBe('客戶教育訓練');
      expect(c.source).toBe('CUSTOMER');
      expect(r[0].overlapCalendarDays).toBe(3);
      // UTC 午夜正規化
      expect(r[0].planStart.getUTCHours()).toBe(0);
    });

    it('部分重疊（壓到流程起點）只計入區間內天數', () => {
      const r = detectExclusionConflicts([FLOW_A], [{ fromDate: '2026-02-10', toDate: '2026-02-17' }]);
      expect(iso(r[0].conflicts[0].overlapFrom)).toBe('2026-02-16');
      expect(iso(r[0].conflicts[0].overlapTo)).toBe('2026-02-17');
      expect(r[0].conflicts[0].overlapCalendarDays).toBe(2);
    });

    it('排除日完全覆蓋流程時，重疊＝流程整段天數', () => {
      const r = detectExclusionConflicts([FLOW_A], [{ fromDate: '2026-02-01', toDate: '2026-03-01' }]);
      expect(r[0].conflicts[0].overlapCalendarDays).toBe(10);
    });

    it('僅端點相接（含端點）視為衝突，重疊 1 天', () => {
      const r = detectExclusionConflicts([FLOW_A], [{ fromDate: '2026-02-25', toDate: '2026-02-28' }]);
      expect(r).toHaveLength(1);
      expect(r[0].conflicts[0].overlapCalendarDays).toBe(1);
    });

    it('相鄰但不重疊（隔一天）不算衝突', () => {
      const r = detectExclusionConflicts([FLOW_A], [{ fromDate: '2026-02-26', toDate: '2026-02-28' }]);
      expect(r).toHaveLength(0);
    });

    it('多筆相互重疊的排除日：conflicts 各自列出，但合計天數取聯集去重', () => {
      const r = detectExclusionConflicts([FLOW_A], [
        { fromDate: '2026-02-18', toDate: '2026-02-20' },
        { fromDate: '2026-02-19', toDate: '2026-02-22' },
      ]);
      expect(r[0].conflicts).toHaveLength(2);
      // 02-18..02-22 = 5 天（非 3+4=7）
      expect(r[0].overlapCalendarDays).toBe(5);
    });

    it('includeFlowsWithoutConflict 時回傳無衝突流程（conflicts 為空）', () => {
      const r = detectExclusionConflicts([FLOW_A], [{ fromDate: '2026-03-01', toDate: '2026-03-02' }], {
        includeFlowsWithoutConflict: true,
      });
      expect(r).toHaveLength(1);
      expect(r[0].conflicts).toHaveLength(0);
      expect(r[0].overlapCalendarDays).toBe(0);
    });

    it('預設不回傳無衝突流程', () => {
      const r = detectExclusionConflicts([FLOW_A], [{ fromDate: '2026-03-01', toDate: '2026-03-02' }]);
      expect(r).toHaveLength(0);
    });

    it('多條流程各自比對', () => {
      const flowB: FlowIntervalInput = { flowId: 'B', planStart: '2026-03-01', planEnd: '2026-03-10' };
      const r = detectExclusionConflicts([FLOW_A, flowB], [{ fromDate: '2026-02-18', toDate: '2026-03-02' }]);
      expect(r.map((x) => x.flowId).sort()).toEqual(['A', 'B']);
    });

    it('流程 planEnd 早於 planStart 拋 invalid_range', () => {
      expect(() =>
        detectExclusionConflicts([{ flowId: 'X', planStart: '2026-02-25', planEnd: '2026-02-16' }], []),
      ).toThrow(ExclusionEngineError);
    });

    it('排除日 toDate 早於 fromDate 拋 invalid_range', () => {
      let code: string | undefined;
      try {
        detectExclusionConflicts([FLOW_A], [{ fromDate: '2026-02-20', toDate: '2026-02-18' }]);
      } catch (e) {
        if (e instanceof ExclusionEngineError) code = e.code;
      }
      expect(code).toBe('invalid_range');
    });

    it('非法日期拋 invalid_date', () => {
      let code: string | undefined;
      try {
        detectExclusionConflicts([FLOW_A], [{ fromDate: 'not-a-date', toDate: '2026-02-18' }]);
      } catch (e) {
        if (e instanceof ExclusionEngineError) code = e.code;
      }
      expect(code).toBe('invalid_date');
    });
  });

  describe('hasAnyExclusionConflict', () => {
    it('有重疊回 true、無重疊回 false', () => {
      expect(hasAnyExclusionConflict([FLOW_A], [{ fromDate: '2026-02-18', toDate: '2026-02-20' }])).toBe(true);
      expect(hasAnyExclusionConflict([FLOW_A], [{ fromDate: '2026-03-01', toDate: '2026-03-02' }])).toBe(false);
    });
  });
});
