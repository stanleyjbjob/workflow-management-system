import { describe, expect, it } from 'vitest';
import {
  buildKpiCards,
  derivePresentationLayout,
  formatDelta,
  isPresentation,
  presentationHeadline,
  presentationKeydown,
  selectKpiCards,
  statusMeta,
  toggleMode,
} from './presentation';
import { sampleProjectGantt } from './seed';
import type { GanttKpis } from './types';

const kpis: GanttKpis = {
  overallProgress: 62,
  delayedCount: 2,
  aheadCount: 1,
  onTimeCount: 3,
  completedCount: 1,
  notStartedCount: 1,
  exclusionRangeCount: 2,
};

describe('toggleMode / isPresentation', () => {
  it('NORMAL ↔ PRESENTATION 來回切換', () => {
    expect(toggleMode('NORMAL')).toBe('PRESENTATION');
    expect(toggleMode('PRESENTATION')).toBe('NORMAL');
    expect(isPresentation('PRESENTATION')).toBe(true);
    expect(isPresentation('NORMAL')).toBe(false);
  });
});

describe('derivePresentationLayout', () => {
  it('一般模式顯示側欄與次要 chrome、不沉浸', () => {
    const l = derivePresentationLayout('NORMAL');
    expect(l.showSidebar).toBe(true);
    expect(l.showSecondaryChrome).toBe(true);
    expect(l.immersive).toBe(false);
    expect(l.fontScale).toBe(1);
  });

  it('簡報模式隱藏側欄與次要 chrome、沉浸並放大', () => {
    const l = derivePresentationLayout('PRESENTATION');
    expect(l.showSidebar).toBe(false);
    expect(l.showSecondaryChrome).toBe(false);
    expect(l.immersive).toBe(true);
    expect(l.fontScale).toBeGreaterThan(1);
    expect(l.rowHeightPx).toBeGreaterThan(derivePresentationLayout('NORMAL').rowHeightPx);
    expect(l.timelineMinHeightPx).toBeGreaterThan(
      derivePresentationLayout('NORMAL').timelineMinHeightPx,
    );
  });

  it('回傳副本，變動結果不影響後續呼叫（不共享可變狀態）', () => {
    const a = derivePresentationLayout('PRESENTATION');
    a.showSidebar = true;
    const b = derivePresentationLayout('PRESENTATION');
    expect(b.showSidebar).toBe(false);
  });
});

describe('presentationKeydown', () => {
  it('Esc 永遠退出簡報', () => {
    expect(presentationKeydown('Escape', 'PRESENTATION')).toBe('NORMAL');
    expect(presentationKeydown('Escape', 'NORMAL')).toBe('NORMAL');
  });

  it('F / P（不分大小寫）切換模式', () => {
    expect(presentationKeydown('f', 'NORMAL')).toBe('PRESENTATION');
    expect(presentationKeydown('F', 'NORMAL')).toBe('PRESENTATION');
    expect(presentationKeydown('p', 'PRESENTATION')).toBe('NORMAL');
    expect(presentationKeydown('P', 'PRESENTATION')).toBe('NORMAL');
  });

  it('其他鍵不處理（回 null）', () => {
    expect(presentationKeydown('a', 'NORMAL')).toBeNull();
    expect(presentationKeydown('Enter', 'PRESENTATION')).toBeNull();
  });
});

describe('statusMeta / formatDelta', () => {
  it('五態皆有繁中標籤與顏色', () => {
    expect(statusMeta('COMPLETED').label).toBe('已完成');
    expect(statusMeta('ON_TIME').label).toBe('準時');
    expect(statusMeta('AHEAD').label).toBe('超前');
    expect(statusMeta('DELAYED').label).toBe('延遲');
    expect(statusMeta('NOT_STARTED').label).toBe('未開始');
    expect(statusMeta('DELAYED').color).toMatch(/^#/);
  });

  it('delta 格式化帶正負號', () => {
    expect(formatDelta(12)).toBe('+12');
    expect(formatDelta(-8)).toBe('-8');
    expect(formatDelta(0)).toBe('0');
    expect(formatDelta(3.6)).toBe('+4');
  });
});

describe('buildKpiCards / selectKpiCards', () => {
  it('產生全部 KPI 卡，整體進度與延遲為重點卡', () => {
    const cards = buildKpiCards(kpis);
    expect(cards).toHaveLength(7);
    const overall = cards.find((c) => c.key === 'overall');
    expect(overall?.value).toBe('62%');
    expect(overall?.highlight).toBe(true);
    expect(cards.find((c) => c.key === 'delayed')?.highlight).toBe(true);
  });

  it('延遲為 0 時延遲卡著色轉為 muted', () => {
    const cards = buildKpiCards({ ...kpis, delayedCount: 0 });
    expect(cards.find((c) => c.key === 'delayed')?.tone).toBe('muted');
  });

  it('簡報模式只挑重點卡，一般模式呈現全部', () => {
    expect(selectKpiCards(kpis, 'PRESENTATION').every((c) => c.highlight)).toBe(true);
    expect(selectKpiCards(kpis, 'PRESENTATION').length).toBeLessThan(
      selectKpiCards(kpis, 'NORMAL').length,
    );
    expect(selectKpiCards(kpis, 'NORMAL')).toHaveLength(7);
  });
});

describe('presentationHeadline', () => {
  it('有延遲時點名延遲數', () => {
    const view = { ...sampleProjectGantt.view, kpis };
    expect(presentationHeadline(view)).toContain('整體進度 62%');
    expect(presentationHeadline(view)).toContain('2 個流程延遲');
  });

  it('無延遲有超前時點名超前數', () => {
    const view = { ...sampleProjectGantt.view, kpis: { ...kpis, delayedCount: 0 } };
    expect(presentationHeadline(view)).toContain('1 個流程超前');
  });

  it('皆無時報大致準時', () => {
    const view = {
      ...sampleProjectGantt.view,
      kpis: { ...kpis, delayedCount: 0, aheadCount: 0 },
    };
    expect(presentationHeadline(view)).toContain('進度大致準時');
  });
});

describe('簡報模式不影響資料', () => {
  it('推導版面 / 挑卡 / 摘要皆不變動原始 view 物件', () => {
    const snapshot = JSON.stringify(sampleProjectGantt);
    derivePresentationLayout('PRESENTATION');
    selectKpiCards(sampleProjectGantt.view.kpis, 'PRESENTATION');
    buildKpiCards(sampleProjectGantt.view.kpis);
    presentationHeadline(sampleProjectGantt.view);
    expect(JSON.stringify(sampleProjectGantt)).toBe(snapshot);
  });
});
