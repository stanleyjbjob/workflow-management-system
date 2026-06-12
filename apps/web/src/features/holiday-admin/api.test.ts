import { describe, expect, it } from 'vitest';
import { holidayQuery } from './api';

describe('holidayQuery', () => {
  it('無參數 → 空字串', () => {
    expect(holidayQuery()).toBe('');
    expect(holidayQuery({})).toBe('');
  });

  it('空值（null / 空字串）一律略過', () => {
    expect(holidayQuery({ from: '', to: null, type: '' })).toBe('');
  });

  it('完整參數', () => {
    expect(holidayQuery({ from: '2026-01-01', to: '2026-12-31', type: 'HOLIDAY' })).toBe(
      '?from=2026-01-01&to=2026-12-31&type=HOLIDAY',
    );
  });

  it('僅部分參數', () => {
    expect(holidayQuery({ type: 'MAKEUP_WORKDAY' })).toBe('?type=MAKEUP_WORKDAY');
    expect(holidayQuery({ from: '2026-06-01' })).toBe('?from=2026-06-01');
  });
});
