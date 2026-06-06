import {
  DEFAULT_TOLERANCE_THRESHOLD,
  GanttEngineError,
  buildGantt,
  buildMonthTicks,
  classifyFlowStatus,
  expectedProgress,
  ratioOf,
  toIsoDate,
} from './gantt-engine';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('gantt-engine 純函式', () => {
  describe('toIsoDate / ratioOf', () => {
    it('toIsoDate 以 UTC 補零格式化', () => {
      expect(toIsoDate(d('2026-01-05'))).toBe('2026-01-05');
      expect(toIsoDate(new Date('2026-12-31T23:59:59.000Z'))).toBe('2026-12-31');
    });

    it('ratioOf 端點為 0 與 1、中點約 0.5', () => {
      const s = d('2026-01-01');
      const e = d('2026-01-11'); // 跨 10 天
      expect(ratioOf(s, s, e)).toBeCloseTo(0, 6);
      expect(ratioOf(e, s, e)).toBeCloseTo(1, 6);
      expect(ratioOf(d('2026-01-06'), s, e)).toBeCloseTo(0.5, 6);
    });

    it('ratioOf 夾擠超出範圍者', () => {
      const s = d('2026-01-01');
      const e = d('2026-01-11');
      expect(ratioOf(d('2025-12-01'), s, e)).toBe(0);
      expect(ratioOf(d('2026-02-01'), s, e)).toBe(1);
    });

    it('ratioOf 零跨距時 date<start→0 否則 1', () => {
      const s = d('2026-01-01');
      expect(ratioOf(d('2025-12-31'), s, s)).toBe(0);
      expect(ratioOf(s, s, s)).toBe(1);
    });
  });

  describe('expectedProgress（§4.2 線性）', () => {
    const s = d('2026-01-01');
    const e = d('2026-01-11');
    it('未開始為 0、結束後為 100', () => {
      expect(expectedProgress(s, e, d('2025-12-20'))).toBe(0);
      expect(expectedProgress(s, e, d('2026-02-01'))).toBe(100);
    });
    it('起點 0、中點約 50、終點 100', () => {
      expect(expectedProgress(s, e, s)).toBe(0);
      expect(expectedProgress(s, e, d('2026-01-06'))).toBe(50);
      expect(expectedProgress(s, e, e)).toBe(100);
    });
    it('零工期：now>=planEnd 為 100，否則 0', () => {
      expect(expectedProgress(s, s, d('2025-12-31'))).toBe(0);
      expect(expectedProgress(s, s, s)).toBe(100);
    });
  });

  describe('classifyFlowStatus（§4.3）', () => {
    const base = { now: d('2026-01-06'), planStart: d('2026-01-01'), threshold: 8 };
    it('progress>=100 → 完成（優先於其他）', () => {
      expect(classifyFlowStatus({ ...base, progress: 100, expected: 50 }).status).toBe('COMPLETED');
    });
    it('now<planStart → 未開始', () => {
      const r = classifyFlowStatus({ progress: 0, expected: 0, now: d('2025-12-20'), planStart: d('2026-01-01'), threshold: 8 });
      expect(r.status).toBe('NOT_STARTED');
    });
    it('落後超過 T → 延遲', () => {
      // expected 50, progress 30, delta -20 < -8
      const r = classifyFlowStatus({ ...base, progress: 30, expected: 50 });
      expect(r.status).toBe('DELAYED');
      expect(r.delta).toBe(-20);
    });
    it('領先超過 T → 超前', () => {
      const r = classifyFlowStatus({ ...base, progress: 70, expected: 50 });
      expect(r.status).toBe('AHEAD');
      expect(r.delta).toBe(20);
    });
    it('落在 ±T 內 → 準時（邊界含端點）', () => {
      expect(classifyFlowStatus({ ...base, progress: 50, expected: 50 }).status).toBe('ON_TIME');
      expect(classifyFlowStatus({ ...base, progress: 58, expected: 50 }).status).toBe('ON_TIME'); // delta=+8
      expect(classifyFlowStatus({ ...base, progress: 42, expected: 50 }).status).toBe('ON_TIME'); // delta=-8
    });
  });

  describe('buildMonthTicks', () => {
    it('跨年產生連續月份刻度，第一個 startRatio=0', () => {
      const ticks = buildMonthTicks(d('2025-11-15'), d('2026-02-10'));
      expect(ticks.map((t) => t.key)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
      expect(ticks[0].startRatio).toBe(0);
      // 月份遞增且 ratio 不遞減
      for (let i = 1; i < ticks.length; i++) {
        expect(ticks[i].startRatio).toBeGreaterThanOrEqual(ticks[i - 1].startRatio);
      }
    });
    it('單月範圍只有一個刻度', () => {
      const ticks = buildMonthTicks(d('2026-03-03'), d('2026-03-20'));
      expect(ticks.map((t) => t.key)).toEqual(['2026-03']);
    });
  });

  describe('buildGantt 整合', () => {
    const params = {
      project: { planStart: '2026-01-01', planEnd: '2026-03-31' },
      now: '2026-02-15',
      flows: [
        { id: 'f1', caseId: 'c1', flowType: '銷售', name: '銷售流程', planStart: '2026-01-01', planEnd: '2026-01-31', progress: 100 },
        { id: 'f2', caseId: 'c2', flowType: '系統導入', name: '導入流程', planStart: '2026-02-01', planEnd: '2026-02-28', progress: 20 },
        { id: 'f3', caseId: null, flowType: '環境建置', name: '環境建置', planStart: '2026-03-01', planEnd: '2026-03-31', progress: 0 },
      ],
      exclusions: [
        { fromDate: '2026-02-10', toDate: '2026-02-12', reason: '客戶系統凍結', source: '客戶提供' },
      ],
    };

    it('軸範圍涵蓋專案與所有流程、今日線落在範圍內且比例正確', () => {
      const g = buildGantt(params);
      expect(g.axis.start).toBe('2026-01-01');
      expect(g.axis.end).toBe('2026-03-31');
      expect(g.today.date).toBe('2026-02-15');
      expect(g.today.inRange).toBe(true);
      expect(g.today.ratio).toBeGreaterThan(0);
      expect(g.today.ratio).toBeLessThan(1);
    });

    it('長條端點比例：f1 起點=0、f3 終點=1', () => {
      const g = buildGantt(params);
      const f1 = g.rows.find((r) => r.id === 'f1')!;
      const f3 = g.rows.find((r) => r.id === 'f3')!;
      expect(f1.startRatio).toBe(0);
      expect(f3.endRatio).toBe(1);
      expect(f1.fillRatio).toBe(1); // 100%
    });

    it('狀態分類：f1 完成、f2 延遲（2/15 預期約 50% 實際 20%）、f3 未開始', () => {
      const g = buildGantt(params);
      const byId = Object.fromEntries(g.rows.map((r) => [r.id, r]));
      expect(byId.f1.status).toBe('COMPLETED');
      expect(byId.f2.status).toBe('DELAYED');
      expect(byId.f3.status).toBe('NOT_STARTED');
    });

    it('KPI：整體進度、延遲/超前/排除日區間數', () => {
      const g = buildGantt(params);
      expect(g.kpis.overallProgress).toBe(40); // (100+20+0)/3 = 40
      expect(g.kpis.delayedCount).toBe(1);
      expect(g.kpis.aheadCount).toBe(0);
      expect(g.kpis.completedCount).toBe(1);
      expect(g.kpis.notStartedCount).toBe(1);
      expect(g.kpis.exclusionRangeCount).toBe(1);
    });

    it('排除日網底比例落在 0..1 且 from<=to', () => {
      const g = buildGantt(params);
      const band = g.exclusions[0];
      expect(band.startRatio).toBeGreaterThanOrEqual(0);
      expect(band.endRatio).toBeLessThanOrEqual(1);
      expect(band.startRatio).toBeLessThanOrEqual(band.endRatio);
      expect(band.reason).toBe('客戶系統凍結');
    });

    it('今日線超出軸範圍時 inRange=false 並夾擠', () => {
      const g = buildGantt({ ...params, now: '2026-06-01' });
      expect(g.today.inRange).toBe(false);
      expect(g.today.ratio).toBe(1);
    });

    it('無流程時 axis 退回專案期間、KPI 全 0', () => {
      const g = buildGantt({ project: { planStart: '2026-01-01', planEnd: '2026-01-31' }, flows: [], now: '2026-01-15' });
      expect(g.axis.start).toBe('2026-01-01');
      expect(g.axis.end).toBe('2026-01-31');
      expect(g.rows).toHaveLength(0);
      expect(g.kpis.overallProgress).toBe(0);
      expect(g.kpis.delayedCount).toBe(0);
    });

    it('流程超出專案期間時，軸自動延展涵蓋', () => {
      const g = buildGantt({
        project: { planStart: '2026-02-01', planEnd: '2026-02-28' },
        now: '2026-02-15',
        flows: [{ id: 'x', name: '提前啟動', planStart: '2026-01-15', planEnd: '2026-03-15', progress: 50 }],
      });
      expect(g.axis.start).toBe('2026-01-15');
      expect(g.axis.end).toBe('2026-03-15');
    });

    it('預設容許門檻為 8', () => {
      expect(DEFAULT_TOLERANCE_THRESHOLD).toBe(8);
    });
  });

  describe('錯誤處理', () => {
    it('專案 planEnd 早於 planStart 拋 invalid_range', () => {
      expect(() => buildGantt({ project: { planStart: '2026-03-01', planEnd: '2026-01-01' }, flows: [] })).toThrow(GanttEngineError);
    });
    it('流程日期非法拋 invalid_date', () => {
      expect(() =>
        buildGantt({ project: { planStart: '2026-01-01', planEnd: '2026-12-31' }, flows: [{ id: 'b', name: 'bad', planStart: 'not-a-date', planEnd: '2026-02-01', progress: 0 }] }),
      ).toThrow(GanttEngineError);
    });
    it('負的容許門檻拋 invalid_threshold', () => {
      expect(() => buildGantt({ project: { planStart: '2026-01-01', planEnd: '2026-12-31' }, flows: [], toleranceThreshold: -1 })).toThrow(GanttEngineError);
    });
    it('排除日 toDate 早於 fromDate 拋 invalid_range', () => {
      expect(() =>
        buildGantt({ project: { planStart: '2026-01-01', planEnd: '2026-12-31' }, flows: [], exclusions: [{ fromDate: '2026-02-10', toDate: '2026-02-01' }] }),
      ).toThrow(GanttEngineError);
    });
  });
});
