/** 任務看板查詢參數組裝測試（issue 8.2 #34）。 */
import { describe, expect, it } from 'vitest';
import { kanbanQuery } from './api';

describe('kanbanQuery', () => {
  it('無參數回傳空字串（取全部，由後端收斂可見範圍）', () => {
    expect(kanbanQuery()).toBe('');
    expect(kanbanQuery({})).toBe('');
  });

  it('組合 role / flowType', () => {
    expect(kanbanQuery({ role: 'ENGINEER', flowType: 'CUSTOMIZATION' })).toBe(
      '?role=ENGINEER&flowType=CUSTOMIZATION',
    );
  });

  it('onlyMine 僅在 true 時輸出', () => {
    expect(kanbanQuery({ onlyMine: true })).toBe('?onlyMine=true');
    expect(kanbanQuery({ onlyMine: false })).toBe('');
  });

  it('upcomingWithinDays 數值輸出；null 略過', () => {
    expect(kanbanQuery({ upcomingWithinDays: 5 })).toBe('?upcomingWithinDays=5');
    expect(kanbanQuery({ upcomingWithinDays: null })).toBe('');
  });

  it('空字串參數視為未提供', () => {
    expect(kanbanQuery({ role: '', assignee: null })).toBe('');
  });
});
