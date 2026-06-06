import {
  cardBadges,
  filterBoard,
  flowTypesIn,
  summarizeKpi,
  ROLE_OPTIONS,
} from './board-view';
import { sampleKanbanBoard } from './seed';
import type { KanbanCard } from './types';

function findCard(id: string): KanbanCard {
  for (const col of sampleKanbanBoard.order) {
    const c = sampleKanbanBoard.columns[col].find((x) => x.stepInstanceId === id);
    if (c) return c;
  }
  throw new Error('not found ' + id);
}

describe('cardBadges', () => {
  it('overdue card shows overdue badge with day count', () => {
    const b = cardBadges(findCard('si-1'));
    expect(b.some((x) => x.kind === 'overdue' && x.label.includes('逾期'))).toBe(true);
    expect(b.some((x) => x.kind === 'forms')).toBe(true);
  });
  it('dueSoon card shows dueSoon badge (workdays)', () => {
    const b = cardBadges(findCard('si-2'));
    expect(b.some((x) => x.kind === 'dueSoon' && x.label.includes('工作日'))).toBe(true);
    expect(b.some((x) => x.kind === 'overdue')).toBe(false);
  });
  it('deferred card shows deferred badge', () => {
    const b = cardBadges(findCard('si-5'));
    expect(b.some((x) => x.kind === 'deferred' && x.label.includes('遞延'))).toBe(true);
  });
  it('completed card shows no due badges', () => {
    const b = cardBadges(findCard('si-6'));
    expect(b.some((x) => x.kind === 'overdue' || x.kind === 'dueSoon')).toBe(false);
  });
});

describe('summarizeKpi', () => {
  it('matches seed board KPI', () => {
    const all = sampleKanbanBoard.order.flatMap((c) => sampleKanbanBoard.columns[c]);
    expect(summarizeKpi(all)).toEqual({ pending: 5, upcoming: 1, overdue: 1, deferred: 1 });
  });
});

describe('filterBoard', () => {
  it('filters by role and recomputes KPI/total', () => {
    const fb = filterBoard(sampleKanbanBoard, { role: 'CONSULTANT' });
    expect(fb.total).toBe(2);
    expect(fb.columns.UPCOMING.map((c) => c.stepInstanceId)).toEqual(['si-2']);
    expect(fb.columns.TODO.map((c) => c.stepInstanceId)).toEqual(['si-5']);
    expect(fb.kpi).toEqual({ pending: 2, upcoming: 1, overdue: 0, deferred: 1 });
  });
  it('filters by flowType', () => {
    const fb = filterBoard(sampleKanbanBoard, { flowType: 'SALES' });
    expect(fb.total).toBe(2);
    expect(fb.activeTotal).toBe(1);
  });
  it('no filter returns same counts', () => {
    const fb = filterBoard(sampleKanbanBoard, {});
    expect(fb.total).toBe(6);
    expect(fb.activeTotal).toBe(5);
  });
});

describe('flowTypesIn / ROLE_OPTIONS', () => {
  it('lists distinct flow types sorted', () => {
    expect(flowTypesIn(sampleKanbanBoard)).toEqual(['CUSTOMIZATION', 'ENVIRONMENT', 'ONBOARDING', 'SALES']);
  });
  it('role options include the six role codes', () => {
    expect(ROLE_OPTIONS.map((r) => r.code)).toEqual(['MANAGER', 'SALES', 'CONSULTANT', 'ENG_LEAD', 'ENGINEER', 'ASSISTANT']);
  });
});
