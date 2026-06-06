import {
  DEFAULT_FLOWTYPE_THRESHOLDS,
  DelayEngineError,
  evaluateFlowDelay,
  evaluateFlows,
  resolveThreshold,
  summarizeDelays,
} from './delay-engine';

describe('delay-engine 純函式（§5.3）', () => {
  describe('resolveThreshold', () => {
    it('無設定回預設 8', () => {
      expect(resolveThreshold(null)).toBe(8);
      expect(resolveThreshold('銷售')).toBe(8);
      expect(DEFAULT_FLOWTYPE_THRESHOLDS.default).toBe(8);
    });
    it('數字＝統一門檻', () => {
      expect(resolveThreshold('任何', 12)).toBe(12);
    });
    it('依流程型別覆寫，未命中回 default', () => {
      const cfg = { default: 8, byFlowType: { 環境建置: 15, 銷售: 5 } };
      expect(resolveThreshold('環境建置', cfg)).toBe(15);
      expect(resolveThreshold('銷售', cfg)).toBe(5);
      expect(resolveThreshold('系統導入', cfg)).toBe(8);
      expect(resolveThreshold(null, cfg)).toBe(8);
    });
    it('負門檻拋 invalid_threshold', () => {
      expect(() => resolveThreshold('x', -1)).toThrow(DelayEngineError);
      expect(() => resolveThreshold('x', { default: 8, byFlowType: { a: -2 } })).toThrow(DelayEngineError);
    });
  });

  describe('五種狀態判斷（驗收要點）', () => {
    const base = { planStart: '2026-01-01', planEnd: '2026-01-11' };
    const at = (progress: number, now = '2026-01-06') =>
      evaluateFlowDelay({ ...base, progress }, { now });

    it('progress>=100 → 完成（優先）', () => {
      expect(at(100).status).toBe('COMPLETED');
    });
    it('now<planStart → 未開始', () => {
      expect(evaluateFlowDelay({ ...base, progress: 0 }, { now: '2025-12-20' }).status).toBe('NOT_STARTED');
    });
    it('落後超過門檻 → 延遲（delta=30-50=-20）', () => {
      const r = at(30);
      expect(r.status).toBe('DELAYED');
      expect(r.deltaPercent).toBe(-20);
    });
    it('領先超過門檻 → 超前（delta=70-50=+20）', () => {
      const r = at(70);
      expect(r.status).toBe('AHEAD');
      expect(r.deltaPercent).toBe(20);
    });
    it('落在 ±T 內 → 準時（含邊界 ±8）', () => {
      expect(at(50).status).toBe('ON_TIME');
      expect(at(58).status).toBe('ON_TIME');
      expect(at(42).status).toBe('ON_TIME');
    });
    it('依流程型別門檻可改變狀態：寬門檻把延遲變準時', () => {
      expect(evaluateFlowDelay({ ...base, flowType: '環境建置', progress: 38 }, { now: '2026-01-06' }).status).toBe('DELAYED');
      expect(
        evaluateFlowDelay(
          { ...base, flowType: '環境建置', progress: 38 },
          { now: '2026-01-06', thresholds: { default: 8, byFlowType: { 環境建置: 15 } } },
        ).status,
      ).toBe('ON_TIME');
    });
  });

  describe('差異天數換算（§4.4）', () => {
    const base = { planStart: '2026-01-01', planEnd: '2026-01-11' };
    it('日曆日基準：落後百分比換算為落後天數', () => {
      const r = evaluateFlowDelay({ ...base, progress: 30 }, { now: '2026-01-06' });
      expect(r.basis).toBe('CALENDAR');
      expect(r.durationDays).toBe(10);
      expect(r.deltaDays).toBe(-2);
      expect(r.delayDays).toBe(2);
      expect(r.aheadDays).toBe(0);
    });
    it('超前換算為超前天數', () => {
      const r = evaluateFlowDelay({ ...base, progress: 70 }, { now: '2026-01-06' });
      expect(r.deltaDays).toBe(2);
      expect(r.aheadDays).toBe(2);
      expect(r.delayDays).toBe(0);
    });
    it('工作日基準：以注入 workdayCounter 計工期', () => {
      const counter = () => 6;
      const r = evaluateFlowDelay({ ...base, progress: 30 }, { now: '2026-01-06', basis: 'WORKDAY', workdayCounter: counter });
      expect(r.basis).toBe('WORKDAY');
      expect(r.durationDays).toBe(6);
      expect(r.deltaDays).toBe(-1);
      expect(r.delayDays).toBe(1);
    });
    it('WORKDAY 基準未提供 counter 拋 workday_counter_required', () => {
      expect(() => evaluateFlowDelay({ ...base, progress: 30 }, { now: '2026-01-06', basis: 'WORKDAY' })).toThrow(DelayEngineError);
    });
    it('已完成 / 未開始流程的差異天數歸零（不誤計超前／落後）', () => {
      const done = evaluateFlowDelay({ planStart: '2026-01-01', planEnd: '2026-01-11', progress: 100 }, { now: '2026-01-06' });
      expect(done.status).toBe('COMPLETED');
      expect(done.deltaDays).toBe(0);
      expect(done.aheadDays).toBe(0);
      const ns = evaluateFlowDelay({ planStart: '2026-02-01', planEnd: '2026-02-11', progress: 0 }, { now: '2026-01-06' });
      expect(ns.status).toBe('NOT_STARTED');
      expect(ns.deltaDays).toBe(0);
    });
    it('零工期（planStart===planEnd）durationDays 退回 1', () => {
      const r = evaluateFlowDelay({ planStart: '2026-01-05', planEnd: '2026-01-05', progress: 0 }, { now: '2026-01-05' });
      expect(r.durationDays).toBe(1);
    });
  });

  describe('差異百分比正確（驗收要點）', () => {
    it('deltaPercent = 實際 − 預期（四捨五入）', () => {
      const r = evaluateFlowDelay({ planStart: '2026-01-01', planEnd: '2026-01-11', progress: 45 }, { now: '2026-01-04' });
      expect(r.expected).toBe(30);
      expect(r.actual).toBe(45);
      expect(r.deltaPercent).toBe(15);
    });
    it('progress 夾擠至 0..100', () => {
      const r = evaluateFlowDelay({ planStart: '2026-01-01', planEnd: '2026-01-11', progress: 250 }, { now: '2026-01-06' });
      expect(r.actual).toBe(100);
      expect(r.status).toBe('COMPLETED');
    });
  });

  describe('evaluateFlows / summarizeDelays', () => {
    const flows = [
      { id: 'f1', flowType: '銷售', planStart: '2026-01-01', planEnd: '2026-01-11', progress: 100 },
      { id: 'f2', flowType: '系統導入', planStart: '2026-01-01', planEnd: '2026-01-11', progress: 30 },
      { id: 'f3', flowType: '環境建置', planStart: '2026-01-01', planEnd: '2026-01-11', progress: 70 },
      { id: 'f4', flowType: '客製化', planStart: '2026-02-01', planEnd: '2026-02-11', progress: 0 },
      { id: 'f5', flowType: '銷售', planStart: '2026-01-01', planEnd: '2026-01-11', progress: 50 },
    ];
    it('批次評估數量正確', () => {
      const evals = evaluateFlows(flows, { now: '2026-01-06' });
      expect(evals).toHaveLength(5);
      expect(evals.map((e) => e.id)).toEqual(['f1', 'f2', 'f3', 'f4', 'f5']);
    });
    it('彙總各狀態計數與最大延遲／超前天數', () => {
      const s = summarizeDelays(evaluateFlows(flows, { now: '2026-01-06' }));
      expect(s.total).toBe(5);
      expect(s.completedCount).toBe(1);
      expect(s.delayedCount).toBe(1);
      expect(s.aheadCount).toBe(1);
      expect(s.notStartedCount).toBe(1);
      expect(s.onTimeCount).toBe(1);
      expect(s.maxDelayDays).toBe(2);
      expect(s.maxAheadDays).toBe(2);
    });
  });

  describe('錯誤處理', () => {
    it('planEnd 早於 planStart 拋 invalid_range', () => {
      expect(() => evaluateFlowDelay({ planStart: '2026-03-01', planEnd: '2026-01-01', progress: 0 })).toThrow(DelayEngineError);
    });
    it('非法日期拋 invalid_date', () => {
      expect(() => evaluateFlowDelay({ planStart: 'not-a-date', planEnd: '2026-01-11', progress: 0 })).toThrow(DelayEngineError);
    });
  });
});
