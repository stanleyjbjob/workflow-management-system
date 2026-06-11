/**
 * 專案 REST 串接純函式測試（issue 8.10 #45）：query 組裝與資料映射。
 */
import { describe, expect, it } from 'vitest';
import { delaysQuery, ganttQuery, isoDay, projectOverallProgress, projectsQuery, toProjectGanttData } from './api';
import type { GanttView } from './types';

describe('isoDay', () => {
  it('完整 ISO → YYYY-MM-DD', () => {
    expect(isoDay('2026-06-11T00:00:00.000Z')).toBe('2026-06-11');
  });
  it('已是 YYYY-MM-DD 則原樣', () => {
    expect(isoDay('2026-06-11')).toBe('2026-06-11');
  });
});

describe('projectsQuery', () => {
  it('無參數 → 空字串', () => {
    expect(projectsQuery()).toBe('');
  });
  it('帶 status / ownerId', () => {
    expect(projectsQuery({ status: 'ACTIVE', ownerId: 'u1' })).toBe('?status=ACTIVE&ownerId=u1');
  });
  it('null 略過', () => {
    expect(projectsQuery({ status: null, ownerId: null })).toBe('');
  });
});

describe('ganttQuery', () => {
  it('預設不帶參數', () => {
    expect(ganttQuery()).toBe('');
  });
  it('fresh=false 不輸出（後端僅認 true/1）', () => {
    expect(ganttQuery({ fresh: false })).toBe('');
  });
  it('fresh + toleranceThreshold', () => {
    expect(ganttQuery({ fresh: true, toleranceThreshold: 10 })).toBe('?fresh=true&toleranceThreshold=10');
  });
});

describe('delaysQuery', () => {
  it('basis / threshold / fresh 組合', () => {
    expect(delaysQuery({ fresh: true, basis: 'WORKDAY', threshold: 5 })).toBe('?fresh=true&basis=WORKDAY&threshold=5');
  });
  it('僅 basis', () => {
    expect(delaysQuery({ basis: 'CALENDAR' })).toBe('?basis=CALENDAR');
  });
});

describe('projectOverallProgress', () => {
  it('無流程 → 0', () => {
    expect(projectOverallProgress({ flows: [] })).toBe(0);
  });
  it('平均並四捨五入', () => {
    expect(projectOverallProgress({ flows: [{ id: 'a', progress: 100 }, { id: 'b', progress: 33 }] })).toBe(67);
  });
});

const view: GanttView = {
  axis: { start: '2026-01-01', end: '2026-12-31', totalDays: 365, months: [] },
  today: { date: '2026-06-11', ratio: 0.44, inRange: true },
  rows: [],
  exclusions: [],
  kpis: {
    overallProgress: 0,
    delayedCount: 0,
    aheadCount: 0,
    onTimeCount: 0,
    completedCount: 0,
    notStartedCount: 0,
    exclusionRangeCount: 0,
  },
};

describe('toProjectGanttData', () => {
  it('表頭日期裁為 YYYY-MM-DD、view 原樣透傳', () => {
    const data = toProjectGanttData(
      {
        code: 'PRJ-202606-0001',
        name: '示範專案',
        client: '客戶 A',
        planStart: '2026-01-01T00:00:00.000Z',
        planEnd: '2026-12-31T00:00:00.000Z',
      },
      view,
    );
    expect(data.project).toEqual({
      code: 'PRJ-202606-0001',
      name: '示範專案',
      client: '客戶 A',
      planStart: '2026-01-01',
      planEnd: '2026-12-31',
    });
    expect(data.view).toBe(view);
  });
});
