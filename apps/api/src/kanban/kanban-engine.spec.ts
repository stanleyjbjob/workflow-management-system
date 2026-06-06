import { StepInstanceStatus } from '@prisma/client';
import {
  DEFAULT_UPCOMING_WITHIN_DAYS,
  KANBAN_COLUMN_ORDER,
  KanbanEngineError,
  KanbanTaskInput,
  buildBoard,
  buildCard,
  calendarDaysBetween,
  classifyDue,
  columnOf,
  isActiveStatus,
  isMine,
  matchesFilter,
  resolveTaskDeferral,
  roleMatches,
  summarizeKpi,
} from './kanban-engine';

const NOW = new Date('2026-06-07T00:00:00Z');

function task(overrides: Partial<KanbanTaskInput> = {}): KanbanTaskInput {
  return {
    stepInstanceId: overrides.stepInstanceId ?? 'si-1',
    caseId: overrides.caseId ?? 'case-1',
    status: overrides.status ?? StepInstanceStatus.PENDING,
    ...overrides,
  };
}

describe('calendarDaysBetween', () => {
  it('counts whole UTC days regardless of time-of-day', () => {
    expect(calendarDaysBetween(new Date('2026-06-07T23:00:00Z'), new Date('2026-06-08T01:00:00Z'))).toBe(1);
    expect(calendarDaysBetween(new Date('2026-06-07T00:00:00Z'), new Date('2026-06-07T23:59:59Z'))).toBe(0);
    expect(calendarDaysBetween(new Date('2026-06-10T00:00:00Z'), new Date('2026-06-07T00:00:00Z'))).toBe(-3);
  });
});

describe('isActiveStatus', () => {
  it('PENDING and IN_PROGRESS are active; others are not', () => {
    expect(isActiveStatus(StepInstanceStatus.PENDING)).toBe(true);
    expect(isActiveStatus(StepInstanceStatus.IN_PROGRESS)).toBe(true);
    expect(isActiveStatus(StepInstanceStatus.COMPLETED)).toBe(false);
    expect(isActiveStatus(StepInstanceStatus.SKIPPED)).toBe(false);
    expect(isActiveStatus(StepInstanceStatus.RETURNED)).toBe(false);
  });
});

describe('classifyDue', () => {
  it('returns NONE for non-active status', () => {
    const r = classifyDue(StepInstanceStatus.COMPLETED, new Date('2026-06-01T00:00:00Z'), NOW, 3);
    expect(r.dueState).toBe('NONE');
  });
  it('returns NONE with null days when no due date', () => {
    const r = classifyDue(StepInstanceStatus.PENDING, null, NOW, 3);
    expect(r).toEqual({ dueState: 'NONE', daysUntilDue: null });
  });
  it('flags OVERDUE when due date is before today', () => {
    const r = classifyDue(StepInstanceStatus.IN_PROGRESS, new Date('2026-06-05T00:00:00Z'), NOW, 3);
    expect(r.dueState).toBe('OVERDUE');
    expect(r.daysUntilDue).toBe(-2);
  });
  it('flags UPCOMING when due today (0 days)', () => {
    const r = classifyDue(StepInstanceStatus.PENDING, new Date('2026-06-07T00:00:00Z'), NOW, 3);
    expect(r.dueState).toBe('UPCOMING');
    expect(r.daysUntilDue).toBe(0);
  });
  it('flags UPCOMING at the calendar window boundary (no counter)', () => {
    const r = classifyDue(StepInstanceStatus.PENDING, new Date('2026-06-10T00:00:00Z'), NOW, 3);
    expect(r.dueState).toBe('UPCOMING');
    expect(r.daysUntilDue).toBe(3);
  });
  it('returns NONE just beyond the calendar window', () => {
    const r = classifyDue(StepInstanceStatus.PENDING, new Date('2026-06-11T00:00:00Z'), NOW, 3);
    expect(r.dueState).toBe('NONE');
    expect(r.daysUntilDue).toBe(4);
  });
  it('uses workdaysUntil for the window when provided (calendar 4d but 1 workday => UPCOMING)', () => {
    const r = classifyDue(StepInstanceStatus.PENDING, new Date('2026-06-11T00:00:00Z'), NOW, 3, 1);
    expect(r.dueState).toBe('UPCOMING');
    expect(r.daysUntilDue).toBe(4);
  });
  it('workdaysUntil beyond window => NONE even if few calendar days', () => {
    const r = classifyDue(StepInstanceStatus.PENDING, new Date('2026-06-09T00:00:00Z'), NOW, 3, 5);
    expect(r.dueState).toBe('NONE');
  });
});

describe('columnOf', () => {
  it('COMPLETED to DONE regardless of due', () => {
    expect(columnOf(StepInstanceStatus.COMPLETED, 'NONE')).toBe('DONE');
    expect(columnOf(StepInstanceStatus.COMPLETED, 'UPCOMING')).toBe('DONE');
  });
  it('active and UPCOMING to UPCOMING', () => {
    expect(columnOf(StepInstanceStatus.PENDING, 'UPCOMING')).toBe('UPCOMING');
    expect(columnOf(StepInstanceStatus.IN_PROGRESS, 'UPCOMING')).toBe('UPCOMING');
  });
  it('active and OVERDUE to UPCOMING (overdue folded into the focus lane)', () => {
    expect(columnOf(StepInstanceStatus.PENDING, 'OVERDUE')).toBe('UPCOMING');
    expect(columnOf(StepInstanceStatus.IN_PROGRESS, 'OVERDUE')).toBe('UPCOMING');
  });
  it('IN_PROGRESS none to IN_PROGRESS', () => {
    expect(columnOf(StepInstanceStatus.IN_PROGRESS, 'NONE')).toBe('IN_PROGRESS');
  });
  it('PENDING none to TODO', () => {
    expect(columnOf(StepInstanceStatus.PENDING, 'NONE')).toBe('TODO');
  });
});

describe('roleMatches / isMine / matchesFilter', () => {
  it('roleMatches compares responsibleRoleCode', () => {
    expect(roleMatches(task({ responsibleRoleCode: 'ENGINEER' }), 'ENGINEER')).toBe(true);
    expect(roleMatches(task({ responsibleRoleCode: 'ENGINEER' }), 'SALES')).toBe(false);
    expect(roleMatches(task({ responsibleRoleCode: null }), 'SALES')).toBe(false);
  });
  it('isMine: manager sees all', () => {
    expect(isMine(task({ assigneeId: 'other' }), { isManager: true })).toBe(true);
  });
  it('isMine: assignee match', () => {
    expect(isMine(task({ assigneeId: 'u1' }), { userId: 'u1' })).toBe(true);
    expect(isMine(task({ assigneeId: 'u2' }), { userId: 'u1' })).toBe(false);
  });
  it('isMine: role match', () => {
    expect(isMine(task({ responsibleRoleCode: 'SALES' }), { roleCodes: ['SALES'] })).toBe(true);
    expect(isMine(task({ responsibleRoleCode: 'SALES' }), { roleCodes: ['ENGINEER'] })).toBe(false);
  });
  it('matchesFilter returns true when no filter', () => {
    expect(matchesFilter(task(), undefined, undefined)).toBe(true);
  });
  it('matchesFilter by roleCode', () => {
    expect(matchesFilter(task({ responsibleRoleCode: 'SALES' }), { roleCode: 'SALES' }, undefined)).toBe(true);
    expect(matchesFilter(task({ responsibleRoleCode: 'SALES' }), { roleCode: 'ENGINEER' }, undefined)).toBe(false);
  });
  it('matchesFilter by assigneeId', () => {
    expect(matchesFilter(task({ assigneeId: 'u1' }), { assigneeId: 'u1' }, undefined)).toBe(true);
    expect(matchesFilter(task({ assigneeId: 'u1' }), { assigneeId: 'u2' }, undefined)).toBe(false);
  });
  it('matchesFilter by flowType', () => {
    expect(matchesFilter(task({ flowType: 'SALES' }), { flowType: 'SALES' }, undefined)).toBe(true);
    expect(matchesFilter(task({ flowType: 'SALES' }), { flowType: 'ENVIRONMENT' }, undefined)).toBe(false);
  });
  it('matchesFilter onlyMine combines with viewer', () => {
    const t = task({ assigneeId: 'u1', responsibleRoleCode: 'SALES' });
    expect(matchesFilter(t, { onlyMine: true }, { userId: 'u1' })).toBe(true);
    expect(matchesFilter(t, { onlyMine: true }, { userId: 'u9', roleCodes: [] })).toBe(false);
    expect(matchesFilter(t, { onlyMine: true }, { isManager: true })).toBe(true);
  });
  it('matchesFilter AND-combines multiple conditions', () => {
    const t = task({ assigneeId: 'u1', responsibleRoleCode: 'SALES', flowType: 'SALES' });
    expect(matchesFilter(t, { roleCode: 'SALES', flowType: 'SALES' }, undefined)).toBe(true);
    expect(matchesFilter(t, { roleCode: 'SALES', flowType: 'ENVIRONMENT' }, undefined)).toBe(false);
  });
});

describe('resolveTaskDeferral', () => {
  it('uses explicit deferred flag (defaults days to 1)', () => {
    expect(resolveTaskDeferral(task({ deferred: true }), null)).toEqual({ deferred: true, deferredDays: 1 });
  });
  it('uses explicit deferred flag with provided days', () => {
    expect(resolveTaskDeferral(task({ deferred: true, deferredDays: 3 }), null)).toEqual({ deferred: true, deferredDays: 3 });
  });
  it('not deferred forces days to 0', () => {
    expect(resolveTaskDeferral(task({ deferred: false, deferredDays: 5 }), null)).toEqual({ deferred: false, deferredDays: 0 });
  });
  it('falls back to resolver when deferred unset and due present', () => {
    const due = new Date('2026-06-13T00:00:00Z');
    const resolver = (d: Date) => ({ deferred: d.getUTCDay() === 6, deferredDays: 2 });
    expect(resolveTaskDeferral(task(), due, resolver)).toEqual({ deferred: true, deferredDays: 2 });
  });
  it('resolver ignored when explicit deferred present', () => {
    const resolver = () => ({ deferred: true, deferredDays: 9 });
    expect(resolveTaskDeferral(task({ deferred: false }), new Date('2026-06-13T00:00:00Z'), resolver)).toEqual({ deferred: false, deferredDays: 0 });
  });
  it('no resolver and no flag means not deferred', () => {
    expect(resolveTaskDeferral(task(), new Date('2026-06-13T00:00:00Z'))).toEqual({ deferred: false, deferredDays: 0 });
  });
});

describe('buildCard', () => {
  it('overdue pending now lands in UPCOMING column (overdue marker kept)', () => {
    const card = buildCard(task({ caseCode: 'SALES-1', caseTitle: 'A', flowType: 'SALES', responsibleRoleCode: 'SALES', assigneeId: 'u1', stepName: 'quote', stepOrder: 2, dueDate: new Date('2026-06-05T00:00:00Z') }), { now: NOW });
    expect(card.column).toBe('UPCOMING');
    expect(card.overdue).toBe(true);
    expect(card.dueSoon).toBe(false);
    expect(card.daysUntilDue).toBe(-2);
    expect(card.dueDate).toBe('2026-06-05');
    expect(card.isActive).toBe(true);
    expect(card.flowType).toBe('SALES');
  });
  it('upcoming in-progress lands in UPCOMING column', () => {
    const card = buildCard(task({ dueDate: '2026-06-08', status: StepInstanceStatus.IN_PROGRESS }), { now: NOW });
    expect(card.column).toBe('UPCOMING');
    expect(card.dueSoon).toBe(true);
  });
  it('workday window: far calendar but near workday => UPCOMING + dueSoon', () => {
    const counter = () => 2;
    const card = buildCard(task({ dueDate: '2026-06-15' }), { now: NOW, workdayCounter: counter });
    expect(card.column).toBe('UPCOMING');
    expect(card.dueSoon).toBe(true);
    expect(card.workdaysUntilDue).toBe(2);
    expect(card.daysUntilDue).toBe(8);
  });
  it('completed card to DONE and inactive, no due markers', () => {
    const card = buildCard(task({ status: StepInstanceStatus.COMPLETED, dueDate: '2026-06-01' }), { now: NOW });
    expect(card.column).toBe('DONE');
    expect(card.isActive).toBe(false);
    expect(card.overdue).toBe(false);
    expect(card.dueSoon).toBe(false);
    expect(card.workdaysUntilDue).toBe(null);
  });
  it('applies deferral via resolver', () => {
    const card = buildCard(task({ dueDate: '2026-06-13' }), { now: NOW, deferralResolver: () => ({ deferred: true, deferredDays: 2 }) });
    expect(card.deferred).toBe(true);
    expect(card.deferredDays).toBe(2);
  });
  it('default window is exported constant', () => {
    expect(DEFAULT_UPCOMING_WITHIN_DAYS).toBe(3);
  });
  it('throws on invalid due date', () => {
    expect(() => buildCard(task({ dueDate: 'not-a-date' }), { now: NOW })).toThrow(KanbanEngineError);
  });
  it('throws on invalid window', () => {
    expect(() => buildCard(task(), { now: NOW, upcomingWithinDays: -1 })).toThrow(KanbanEngineError);
    expect(() => buildCard(task(), { now: NOW, upcomingWithinDays: 1.5 })).toThrow(KanbanEngineError);
  });
});

describe('summarizeKpi', () => {
  it('counts pending/upcoming/overdue/deferred over active cards only', () => {
    const cards = [
      buildCard(task({ stepInstanceId: 'a', dueDate: '2026-06-05' }), { now: NOW }),
      buildCard(task({ stepInstanceId: 'b', dueDate: '2026-06-08', status: StepInstanceStatus.IN_PROGRESS }), { now: NOW }),
      buildCard(task({ stepInstanceId: 'c', deferred: true }), { now: NOW }),
      buildCard(task({ stepInstanceId: 'd', status: StepInstanceStatus.COMPLETED }), { now: NOW }),
    ];
    const kpi = summarizeKpi(cards);
    expect(kpi.pending).toBe(3);
    expect(kpi.upcoming).toBe(1);
    expect(kpi.overdue).toBe(1);
    expect(kpi.deferred).toBe(1);
  });
});

describe('buildBoard', () => {
  const tasks: KanbanTaskInput[] = [
    task({ stepInstanceId: 's1', responsibleRoleCode: 'SALES', flowType: 'SALES', assigneeId: 'u1', dueDate: '2026-06-05' }),
    task({ stepInstanceId: 's2', responsibleRoleCode: 'ENGINEER', flowType: 'ENVIRONMENT', status: StepInstanceStatus.IN_PROGRESS, dueDate: '2026-06-20' }),
    task({ stepInstanceId: 's3', responsibleRoleCode: 'CONSULTANT', flowType: 'ONBOARDING', dueDate: '2026-06-08' }),
    task({ stepInstanceId: 's4', responsibleRoleCode: 'ENGINEER', flowType: 'ENVIRONMENT', status: StepInstanceStatus.COMPLETED }),
    task({ stepInstanceId: 's5', responsibleRoleCode: 'ENGINEER', flowType: 'ENVIRONMENT', status: StepInstanceStatus.RETURNED }),
    task({ stepInstanceId: 's6', responsibleRoleCode: 'ENGINEER', flowType: 'ENVIRONMENT', status: StepInstanceStatus.SKIPPED }),
  ];
  it('overdue + upcoming both land in UPCOMING; drops SKIPPED/RETURNED', () => {
    const board = buildBoard(tasks, { options: { now: NOW } });
    expect(board.order).toEqual(KANBAN_COLUMN_ORDER);
    expect(board.columns.TODO.map((c) => c.stepInstanceId)).toEqual([]);
    expect(board.columns.IN_PROGRESS.map((c) => c.stepInstanceId)).toEqual(['s2']);
    expect(board.columns.UPCOMING.map((c) => c.stepInstanceId)).toEqual(['s1', 's3']);
    expect(board.columns.DONE.map((c) => c.stepInstanceId)).toEqual(['s4']);
    expect(board.total).toBe(4);
    expect(board.activeTotal).toBe(3);
  });
  it('computes KPI (upcoming and overdue counted separately)', () => {
    const board = buildBoard(tasks, { options: { now: NOW } });
    expect(board.kpi).toEqual({ pending: 3, upcoming: 1, overdue: 1, deferred: 0 });
  });
  it('filters by role', () => {
    const board = buildBoard(tasks, { filter: { roleCode: 'ENGINEER' }, options: { now: NOW } });
    expect(board.total).toBe(2);
    expect(board.activeTotal).toBe(1);
    expect(board.columns.IN_PROGRESS.map((c) => c.stepInstanceId)).toEqual(['s2']);
    expect(board.columns.DONE).toHaveLength(1);
  });
  it('filters onlyMine by assignee', () => {
    const board = buildBoard(tasks, { filter: { onlyMine: true }, viewer: { userId: 'u1' }, options: { now: NOW } });
    expect(board.total).toBe(1);
    expect(board.columns.UPCOMING.map((c) => c.stepInstanceId)).toEqual(['s1']);
  });
  it('manager onlyMine sees all', () => {
    const board = buildBoard(tasks, { filter: { onlyMine: true }, viewer: { isManager: true }, options: { now: NOW } });
    expect(board.total).toBe(4);
  });
  it('sorts a column by due date ascending then stepOrder', () => {
    const local: KanbanTaskInput[] = [
      task({ stepInstanceId: 'b', dueDate: '2026-09-05', stepOrder: 1 }),
      task({ stepInstanceId: 'a', dueDate: '2026-09-01', stepOrder: 2 }),
      task({ stepInstanceId: 'c', dueDate: null, stepOrder: 0 }),
    ];
    const board = buildBoard(local, { options: { now: NOW } });
    expect(board.columns.TODO.map((c) => c.stepInstanceId)).toEqual(['a', 'b', 'c']);
  });
  it('empty input yields empty board with zero KPI', () => {
    const board = buildBoard([], { options: { now: NOW } });
    expect(board.total).toBe(0);
    expect(board.kpi).toEqual({ pending: 0, upcoming: 0, overdue: 0, deferred: 0 });
    expect(board.columns.TODO).toHaveLength(0);
    expect(board.columns.IN_PROGRESS).toHaveLength(0);
    expect(board.columns.UPCOMING).toHaveLength(0);
    expect(board.columns.DONE).toHaveLength(0);
  });
});
