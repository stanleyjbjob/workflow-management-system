import { holidayRowsToCalendarInput } from './calendar.service';
import {
  buildCalendar,
  deferToWorkday,
  isWorkday,
  parseIsoDate,
  toIsoDate,
} from './calendar-engine';

/**
 * 7.1：驗證 `Holiday` 資料列 → calendar-engine 行事曆輸入之純對應邏輯，
 * 以及與 buildCalendar / isWorkday / deferToWorkday 整合後的工作日判斷正確性。
 */
describe('holidayRowsToCalendarInput', () => {
  it('splits HOLIDAY and MAKEUP_WORKDAY rows by type', () => {
    const rows = [
      { date: parseIsoDate('2026-02-16'), type: 'HOLIDAY' },
      { date: parseIsoDate('2026-02-14'), type: 'MAKEUP_WORKDAY' },
    ];
    const out = holidayRowsToCalendarInput(rows);
    expect(out.holidays).toEqual(['2026-02-16']);
    expect(out.makeupWorkdays).toEqual(['2026-02-14']);
  });

  it('treats unknown / default type as holiday', () => {
    const out = holidayRowsToCalendarInput([{ date: parseIsoDate('2026-04-04'), type: 'HOLIDAY' }]);
    expect(out.holidays).toEqual(['2026-04-04']);
    expect(out.makeupWorkdays).toEqual([]);
  });

  it('makeup workday on a Saturday becomes a workday; holiday on a weekday is non-workday', () => {
    const inp = holidayRowsToCalendarInput([
      { date: parseIsoDate('2026-02-14'), type: 'MAKEUP_WORKDAY' }, // Saturday
      { date: parseIsoDate('2026-02-16'), type: 'HOLIDAY' }, // Monday
    ]);
    const cal = buildCalendar(inp);
    expect(isWorkday(parseIsoDate('2026-02-14'), cal)).toBe(true);
    expect(isWorkday(parseIsoDate('2026-02-16'), cal)).toBe(false);
  });

  it('defers a holiday to the next workday', () => {
    const inp = holidayRowsToCalendarInput([{ date: parseIsoDate('2026-02-16'), type: 'HOLIDAY' }]);
    const cal = buildCalendar(inp);
    // 2026-02-16 (Mon, holiday) -> 2026-02-17 (Tue)
    expect(toIsoDate(deferToWorkday(parseIsoDate('2026-02-16'), cal))).toBe('2026-02-17');
  });

  it('gives priority to holiday when a date is both holiday and makeup workday', () => {
    const inp = holidayRowsToCalendarInput([
      { date: parseIsoDate('2026-03-02'), type: 'HOLIDAY' },
      { date: parseIsoDate('2026-03-02'), type: 'MAKEUP_WORKDAY' },
    ]);
    const cal = buildCalendar(inp);
    // 2026-03-02 is a Monday; holiday priority -> non-workday
    expect(isWorkday(parseIsoDate('2026-03-02'), cal)).toBe(false);
  });
});
