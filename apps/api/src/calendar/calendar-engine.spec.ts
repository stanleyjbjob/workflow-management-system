import {
  CalendarEngineError,
  DeferralMode,
  SAMPLE_TW_FIXED_HOLIDAYS_2026,
  addBusinessDays,
  addDays,
  buildCalendar,
  buildExcludedPredicate,
  businessDaysBetween,
  calendarDaysBetween,
  deferToWorkday,
  isHoliday,
  isMakeupWorkday,
  isNonWorkday,
  isWeekend,
  isWorkday,
  mergeCalendars,
  nextWorkday,
  parseIsoDate,
  previousWorkday,
  reschedule,
  toIsoDate,
  weekdayOf,
  type HolidayCalendar,
} from './calendar-engine';

const d = (iso: string) => parseIsoDate(iso);

describe('calendar-engine 日期工具', () => {
  it('toIsoDate / parseIsoDate round-trip（UTC）', () => {
    expect(toIsoDate(d('2026-06-06'))).toBe('2026-06-06');
    expect(toIsoDate(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01');
  });

  it('parseIsoDate 拒絕格式錯誤', () => {
    expect(() => parseIsoDate('2026/06/06')).toThrow(CalendarEngineError);
    expect(() => parseIsoDate('2026-6-6')).toThrow('calendar_date_invalid');
    expect(() => parseIsoDate('not-a-date')).toThrow(CalendarEngineError);
  });

  it('parseIsoDate 拒絕溢位日期（2026-02-30）', () => {
    expect(() => parseIsoDate('2026-02-30')).toThrow('calendar_date_invalid');
    expect(() => parseIsoDate('2026-13-01')).toThrow('calendar_date_invalid');
  });

  it('toIsoDate 拒絕非法 Date', () => {
    expect(() => toIsoDate(new Date('x'))).toThrow('calendar_date_invalid');
  });

  it('addDays 位移與守門', () => {
    expect(toIsoDate(addDays(d('2026-06-06'), 1))).toBe('2026-06-07');
    expect(toIsoDate(addDays(d('2026-06-06'), -6))).toBe('2026-05-31');
    expect(() => addDays(d('2026-06-06'), 1.5)).toThrow('calendar_days_invalid');
  });

  it('calendarDaysBetween', () => {
    expect(calendarDaysBetween(d('2026-06-06'), d('2026-06-09'))).toBe(3);
    expect(calendarDaysBetween(d('2026-06-09'), d('2026-06-06'))).toBe(-3);
    expect(calendarDaysBetween(d('2026-06-06'), d('2026-06-06'))).toBe(0);
  });

  it('weekdayOf（2026-06-06 為週六=6、06-07 為週日=0、06-08 為週一=1）', () => {
    expect(weekdayOf(d('2026-06-06'))).toBe(6);
    expect(weekdayOf(d('2026-06-07'))).toBe(0);
    expect(weekdayOf(d('2026-06-08'))).toBe(1);
  });
});

describe('buildCalendar / 驗證', () => {
  it('預設週末為週六日', () => {
    const cal = buildCalendar();
    expect(cal.weekendDays.has(0)).toBe(true);
    expect(cal.weekendDays.has(6)).toBe(true);
    expect(cal.weekendDays.has(1)).toBe(false);
  });

  it('正規化假日 / 補班；補班與假日衝突時假日優先', () => {
    const cal = buildCalendar({
      holidays: ['2026-02-17'],
      makeupWorkdays: ['2026-02-14', '2026-02-17'],
    });
    expect(cal.holidays.has('2026-02-17')).toBe(true);
    expect(cal.makeupWorkdays.has('2026-02-14')).toBe(true);
    expect(cal.makeupWorkdays.has('2026-02-17')).toBe(false); // 假日優先
  });

  it('非法假日字串拋錯', () => {
    expect(() => buildCalendar({ holidays: ['2026-99-99'] })).toThrow('calendar_date_invalid');
  });

  it('非法 weekendDays 拋錯', () => {
    expect(() => buildCalendar({ weekendDays: [7] })).toThrow('calendar_weekend_invalid');
    expect(() => buildCalendar({ weekendDays: [-1] })).toThrow('calendar_weekend_invalid');
  });

  it('可自訂週末（如僅週日休）', () => {
    const cal = buildCalendar({ weekendDays: [0] });
    expect(isWeekend(d('2026-06-06'), cal)).toBe(false); // 週六改上班
    expect(isWeekend(d('2026-06-07'), cal)).toBe(true);
  });
});

describe('工作日判斷', () => {
  const cal = buildCalendar({
    holidays: ['2026-01-01'],
    makeupWorkdays: ['2026-01-03'], // 週六補班
  });

  it('一般平日為工作日', () => {
    expect(isWorkday(d('2026-01-02'), cal)).toBe(true); // 週五
  });
  it('週末非工作日', () => {
    expect(isWorkday(d('2026-01-04'), cal)).toBe(false); // 週日
    expect(isWeekend(d('2026-01-04'), cal)).toBe(true);
  });
  it('假日非工作日', () => {
    expect(isWorkday(d('2026-01-01'), cal)).toBe(false);
    expect(isHoliday(d('2026-01-01'), cal)).toBe(true);
  });
  it('補班日為工作日（雖為週六）', () => {
    expect(weekdayOf(d('2026-01-03'))).toBe(6);
    expect(isMakeupWorkday(d('2026-01-03'), cal)).toBe(true);
    expect(isWorkday(d('2026-01-03'), cal)).toBe(true);
  });
  it('isNonWorkday 為 isWorkday 之反', () => {
    expect(isNonWorkday(d('2026-01-01'), cal)).toBe(true);
    expect(isNonWorkday(d('2026-01-02'), cal)).toBe(false);
  });
});

describe('buildExcludedPredicate（供 onboarding buildSchedule 注入）', () => {
  const cal = buildCalendar({ holidays: ['2026-01-01'] });

  it('非工作日回 true', () => {
    const ex = buildExcludedPredicate(cal);
    expect(ex(d('2026-01-01'))).toBe(true); // 假日
    expect(ex(d('2026-01-03'))).toBe(true); // 週六
    expect(ex(d('2026-01-02'))).toBe(false); // 週五
  });

  it('額外排除日（專案排除日 §10.5）併入', () => {
    const ex = buildExcludedPredicate(cal, (x) => toIsoDate(x) === '2026-01-05');
    expect(ex(d('2026-01-05'))).toBe(true); // 週一但被專案排除
    expect(ex(d('2026-01-06'))).toBe(false);
  });
});

describe('遞延 / 工作日運算', () => {
  // 連假：2026-02-16(一)~02-20(五) 放假，週末 02-21/22
  const cal = buildCalendar({
    holidays: ['2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20'],
  });

  it('deferToWorkday：工作日原樣回傳', () => {
    expect(toIsoDate(deferToWorkday(d('2026-02-13'), cal))).toBe('2026-02-13'); // 週五
  });

  it('deferToWorkday：連假 + 週末整段遞延至下個工作日（02-23 週一）', () => {
    expect(toIsoDate(deferToWorkday(d('2026-02-16'), cal))).toBe('2026-02-23');
    expect(toIsoDate(deferToWorkday(d('2026-02-21'), cal))).toBe('2026-02-23'); // 週六起算
  });

  it('nextWorkday：嚴格往後', () => {
    expect(toIsoDate(nextWorkday(d('2026-02-13'), cal))).toBe('2026-02-23'); // 週五 → 跨連假
    expect(toIsoDate(nextWorkday(d('2026-02-23'), cal))).toBe('2026-02-24');
  });

  it('previousWorkday：嚴格往前', () => {
    expect(toIsoDate(previousWorkday(d('2026-02-23'), cal))).toBe('2026-02-13');
  });

  it('addBusinessDays：0 = 基準工作日（起點落假日先遞延）', () => {
    expect(toIsoDate(addBusinessDays(d('2026-02-16'), 0, cal))).toBe('2026-02-23');
  });

  it('addBusinessDays：往後跳工作日跳過連假', () => {
    // 02-13(五) 起 +1 工作日 = 02-23(一)
    expect(toIsoDate(addBusinessDays(d('2026-02-13'), 1, cal))).toBe('2026-02-23');
    // +2 = 02-24, +3 = 02-25
    expect(toIsoDate(addBusinessDays(d('2026-02-13'), 3, cal))).toBe('2026-02-25');
  });

  it('addBusinessDays：負數往前', () => {
    expect(toIsoDate(addBusinessDays(d('2026-02-24'), -1, cal))).toBe('2026-02-23');
    expect(toIsoDate(addBusinessDays(d('2026-02-24'), -2, cal))).toBe('2026-02-13');
  });

  it('addBusinessDays：非整數拋錯', () => {
    expect(() => addBusinessDays(d('2026-02-13'), 1.2, cal)).toThrow('calendar_days_invalid');
  });

  it('businessDaysBetween：略過連假 / 週末', () => {
    // 02-13(五) 到 02-24(二)：工作日為 02-23、02-24 共 2 天
    expect(businessDaysBetween(d('2026-02-13'), d('2026-02-24'), cal)).toBe(2);
    expect(businessDaysBetween(d('2026-02-24'), d('2026-02-13'), cal)).toBe(-2);
    expect(businessDaysBetween(d('2026-02-13'), d('2026-02-13'), cal)).toBe(0);
  });

  it('全為假日時遞延拋 calendar_no_workday', () => {
    const allHoliday = buildCalendar({ weekendDays: [0, 1, 2, 3, 4, 5, 6] });
    expect(() => deferToWorkday(d('2026-03-01'), allHoliday)).toThrow('calendar_no_workday');
  });
});

describe('reschedule 時程重算', () => {
  // 連假 02-16~02-20；週末 02-21/22、02-14/15
  const cal = buildCalendar({
    holidays: ['2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20'],
  });
  const anchor = d('2026-02-13'); // 週五
  const checkpoints = [
    { key: 'kickoff', offsetDays: 0 },
    { key: 'collect', offsetDays: 3 }, // 02-16 連假首日
    { key: 'handoff', offsetDays: 5 }, // 02-18 連假中
  ];

  it('NEXT_WORKDAY：各點獨立遞延', () => {
    const out = reschedule(anchor, checkpoints, cal, DeferralMode.NEXT_WORKDAY);
    const byKey = Object.fromEntries(out.map((o) => [o.key, o]));
    expect(toIsoDate(byKey.kickoff.plannedDate)).toBe('2026-02-13'); // 工作日不動
    expect(byKey.kickoff.deferredDays).toBe(0);
    expect(toIsoDate(byKey.collect.plannedDate)).toBe('2026-02-23'); // 02-16 → 02-23
    expect(byKey.collect.deferredDays).toBe(7);
    expect(toIsoDate(byKey.handoff.plannedDate)).toBe('2026-02-23'); // 02-18 → 02-23（與 collect 同日）
  });

  it('PUSH_FORWARD：位移以工作日計，後續整段後推', () => {
    const out = reschedule(anchor, checkpoints, cal, DeferralMode.PUSH_FORWARD);
    const byKey = Object.fromEntries(out.map((o) => [o.key, o]));
    expect(toIsoDate(byKey.kickoff.plannedDate)).toBe('2026-02-13'); // 0 工作日
    expect(toIsoDate(byKey.collect.plannedDate)).toBe('2026-02-25'); // +3 工作日：23,24,25
    expect(toIsoDate(byKey.handoff.plannedDate)).toBe('2026-02-27'); // +5 工作日：23,24,25,26,27
  });

  it('預設模式為 NEXT_WORKDAY', () => {
    const out = reschedule(anchor, checkpoints, cal);
    const collect = out.find((o) => o.key === 'collect')!;
    expect(toIsoDate(collect.plannedDate)).toBe('2026-02-23');
  });

  it('輸出依 plannedDate 由早到晚排序', () => {
    const out = reschedule(anchor, checkpoints, cal, DeferralMode.PUSH_FORWARD);
    const times = out.map((o) => o.plannedDate.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('非法錨點 / 位移拋錯', () => {
    expect(() => reschedule(new Date('x'), checkpoints, cal)).toThrow('calendar_anchor_required');
    expect(() => reschedule(anchor, [{ key: 'k', offsetDays: -1 }], cal)).toThrow('calendar_offset_invalid');
    expect(() => reschedule(anchor, [{ key: 'k', offsetDays: 1.5 }], cal)).toThrow('calendar_offset_invalid');
  });

  it('專案排除日（extraExcluded）參與遞延', () => {
    // 02-23 額外排除 → collect 應再順延至 02-24
    const out = reschedule(anchor, checkpoints, cal, DeferralMode.NEXT_WORKDAY, (x) => toIsoDate(x) === '2026-02-23');
    const collect = out.find((o) => o.key === 'collect')!;
    expect(toIsoDate(collect.plannedDate)).toBe('2026-02-24');
  });
});

describe('mergeCalendars', () => {
  it('聯集假日 / 週末，假日優先於補班', () => {
    const a = buildCalendar({ holidays: ['2026-01-01'], makeupWorkdays: ['2026-01-03'] });
    const b = buildCalendar({ holidays: ['2026-01-03'], weekendDays: [0, 6] });
    const m = mergeCalendars(a, b);
    expect(m.holidays.has('2026-01-01')).toBe(true);
    expect(m.holidays.has('2026-01-03')).toBe(true);
    expect(m.makeupWorkdays.has('2026-01-03')).toBe(false); // 被 b 的假日覆蓋
  });
});

describe('SAMPLE_TW_FIXED_HOLIDAYS_2026', () => {
  it('含元旦與國慶等固定日且皆為合法日期', () => {
    expect(SAMPLE_TW_FIXED_HOLIDAYS_2026).toContain('2026-01-01');
    expect(SAMPLE_TW_FIXED_HOLIDAYS_2026).toContain('2026-10-10');
    const cal = buildCalendar({ holidays: [...SAMPLE_TW_FIXED_HOLIDAYS_2026] });
    expect(isHoliday(d('2026-01-01'), cal)).toBe(true);
    expect(isWorkday(d('2026-10-10'), cal)).toBe(false);
  });
});
