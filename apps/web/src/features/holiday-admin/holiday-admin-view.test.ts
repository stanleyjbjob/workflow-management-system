import { describe, expect, it } from 'vitest';
import {
  defaultFilter,
  draftFromRecord,
  emptyDraft,
  isoDateOf,
  sourceLabel,
  toHolidayQuery,
  typeLabel,
  validateDraft,
  writeErrorMessage,
  yearRange,
} from './holiday-admin-view';
import type { HolidayRecord } from './types';

const record = (over: Partial<HolidayRecord> = {}): HolidayRecord => ({
  id: 'h1',
  date: '2026-02-16T00:00:00.000Z',
  name: '春節',
  type: 'HOLIDAY',
  source: 'GOVERNMENT',
  note: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('labels / isoDateOf / yearRange', () => {
  it('類型與來源顯示名稱（未知代碼原樣）', () => {
    expect(typeLabel('HOLIDAY')).toBe('假日');
    expect(typeLabel('MAKEUP_WORKDAY')).toBe('補班');
    expect(typeLabel('X')).toBe('X');
    expect(sourceLabel('GOVERNMENT')).toBe('政府行事曆');
    expect(sourceLabel('COMPANY')).toBe('公司自訂');
    expect(sourceLabel('Y')).toBe('Y');
  });

  it('isoDateOf：ISO 字串取日期部位；短字串原樣', () => {
    expect(isoDateOf('2026-02-16T00:00:00.000Z')).toBe('2026-02-16');
    expect(isoDateOf('2026-02-16')).toBe('2026-02-16');
    expect(isoDateOf('bad')).toBe('bad');
  });

  it('yearRange：全年區間', () => {
    expect(yearRange(2026)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });
});

describe('defaultFilter / toHolidayQuery', () => {
  it('預設為 today（UTC）所在年度全年、全部類型', () => {
    const f = defaultFilter(new Date('2026-06-12T15:00:00.000Z'));
    expect(f).toEqual({ from: '2026-01-01', to: '2026-12-31', type: '' });
  });

  it('toHolidayQuery 保留欄位（空字串由 buildQuery 略過）', () => {
    expect(toHolidayQuery({ from: '2026-01-01', to: '2026-12-31', type: 'HOLIDAY' })).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
      type: 'HOLIDAY',
    });
  });
});

describe('emptyDraft / draftFromRecord', () => {
  it('emptyDraft 預設假日／政府來源', () => {
    expect(emptyDraft()).toEqual({ date: '', name: '', type: 'HOLIDAY', source: 'GOVERNMENT', note: '' });
  });

  it('draftFromRecord：日期取 yyyy-mm-dd、note null → 空字串、未知 type/source 正規化', () => {
    expect(draftFromRecord(record())).toEqual({
      date: '2026-02-16',
      name: '春節',
      type: 'HOLIDAY',
      source: 'GOVERNMENT',
      note: '',
    });
    expect(draftFromRecord(record({ type: 'MAKEUP_WORKDAY', source: 'COMPANY', note: '補 2/16' }))).toEqual({
      date: '2026-02-16',
      name: '春節',
      type: 'MAKEUP_WORKDAY',
      source: 'COMPANY',
      note: '補 2/16',
    });
    expect(draftFromRecord(record({ type: 'weird', source: 'weird' })).type).toBe('HOLIDAY');
    expect(draftFromRecord(record({ type: 'weird', source: 'weird' })).source).toBe('GOVERNMENT');
  });
});

describe('validateDraft', () => {
  const base = { date: '2026-02-16', name: '春節', type: 'HOLIDAY' as const, source: 'GOVERNMENT' as const, note: '' };

  it('合法草稿 → payload（note 空字串 → null；name/note trim）', () => {
    const v = validateDraft({ ...base, name: ' 春節 ', note: '  ' });
    expect(v).toEqual({
      ok: true,
      payload: { date: '2026-02-16', name: '春節', type: 'HOLIDAY', source: 'GOVERNMENT', note: null },
    });
  });

  it('note 有值則保留 trim 後內容', () => {
    const v = validateDraft({ ...base, note: ' 連假 ' });
    expect(v.ok && v.payload.note).toBe('連假');
  });

  it('日期格式錯誤 / 不存在日期 → holiday_date_invalid', () => {
    expect(validateDraft({ ...base, date: '' })).toEqual({ ok: false, code: 'holiday_date_invalid' });
    expect(validateDraft({ ...base, date: '2026/02/16' })).toEqual({ ok: false, code: 'holiday_date_invalid' });
    expect(validateDraft({ ...base, date: '2026-2-16' })).toEqual({ ok: false, code: 'holiday_date_invalid' });
    expect(validateDraft({ ...base, date: '2026-02-30' })).toEqual({ ok: false, code: 'holiday_date_invalid' });
    expect(validateDraft({ ...base, date: '2026-13-01' })).toEqual({ ok: false, code: 'holiday_date_invalid' });
  });

  it('名稱空白 → holiday_name_required', () => {
    expect(validateDraft({ ...base, name: '' })).toEqual({ ok: false, code: 'holiday_name_required' });
    expect(validateDraft({ ...base, name: '   ' })).toEqual({ ok: false, code: 'holiday_name_required' });
  });
});

describe('writeErrorMessage', () => {
  it('已知錯誤碼 → 中文提示', () => {
    expect(writeErrorMessage('holiday_date_duplicate', 'x')).toContain('已有假日');
    expect(writeErrorMessage('holiday_date_invalid', 'x')).toContain('yyyy-mm-dd');
    expect(writeErrorMessage('holiday_name_required', 'x')).toContain('名稱必填');
    expect(writeErrorMessage('forbidden', 'x')).toContain('僅主管');
  });

  it('未知錯誤碼 → fallback', () => {
    expect(writeErrorMessage('boom', '寫入失敗')).toBe('寫入失敗');
  });
});
