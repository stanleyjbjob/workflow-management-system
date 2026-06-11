import { describe, expect, it } from 'vitest';
import {
  cardBadges,
  filterBoard,
  flowTypesIn,
  summarizeKpi,
  mergeFlowOptions,
  toKanbanQuery,
  DEFAULT_KANBAN_FILTER,
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

describe('toKanbanQuery / DEFAULT_KANBAN_FILTER（issue 8.9 #44 伺服端過濾）', () => {
  it('預設過濾器→不送任何參數（kanbanQuery 應組出空字串）', () => {
    const q = toKanbanQuery(DEFAULT_KANBAN_FILTER);
    expect(q.role).toBeNull();
    expect(q.flowType).toBeNull();
    expect(q.onlyMine).toBe(false);
    expect(q.upcomingWithinDays).toBeNull();
  });

  it('role / flowType 空字串視為未過濾、有值原樣帶出', () => {
    expect(toKanbanQuery({ ...DEFAULT_KANBAN_FILTER, role: 'ENGINEER' }).role).toBe('ENGINEER');
    expect(toKanbanQuery({ ...DEFAULT_KANBAN_FILTER, flowType: 'SALES' }).flowType).toBe('SALES');
  });

  it('onlyMine 透傳布林', () => {
    expect(toKanbanQuery({ ...DEFAULT_KANBAN_FILTER, onlyMine: true }).onlyMine).toBe(true);
  });

  it('upcomingWithinDays 等於後端預設 3 時不送；其他值帶出', () => {
    expect(toKanbanQuery({ ...DEFAULT_KANBAN_FILTER, upcomingWithinDays: 3 }).upcomingWithinDays).toBeNull();
    expect(toKanbanQuery({ ...DEFAULT_KANBAN_FILTER, upcomingWithinDays: 7 }).upcomingWithinDays).toBe(7);
  });
});

describe('mergeFlowOptions', () => {
  it('永遠包含四種固定流程型別（不因當前看板縮水）', () => {
    const codes = mergeFlowOptions(sampleKanbanBoard).map((o) => o.code);
    for (const c of ['SALES', 'ONBOARDING', 'ENVIRONMENT', 'CUSTOMIZATION']) {
      expect(codes).toContain(c);
    }
  });

  it('看板出現未知型別時附加於後', () => {
    const extra: KanbanCard = { ...findCard('si-4'), stepInstanceId: 'si-x', flowType: 'FUTURE_FLOW' };
    const board = {
      ...sampleKanbanBoard,
      columns: { ...sampleKanbanBoard.columns, TODO: [...sampleKanbanBoard.columns.TODO, extra] },
    };
    const opts = mergeFlowOptions(board);
    expect(opts[opts.length - 1]).toEqual({ code: 'FUTURE_FLOW', label: 'FUTURE_FLOW' });
  });
});
