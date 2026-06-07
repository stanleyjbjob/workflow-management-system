/** 稽核軌跡查詢參數組裝測試（issue 8.3 #35）。 */
import { describe, expect, it } from 'vitest';
import { EMPTY_TRAIL_FILTER, exportCsvUrl, exportJsonUrl, exportQuery, filterToQuery, trailQuery } from './api';

describe('trailQuery', () => {
  it('無參數回傳空字串（取全部，由後端收斂可見範圍）', () => {
    expect(trailQuery()).toBe('');
    expect(trailQuery({})).toBe('');
  });

  it('組合 recordType（多值逗號）與 caseId / 日期', () => {
    expect(
      trailQuery({ recordType: 'FORM_SUBMISSION,ATTACHMENT', caseId: 'case-1', from: '2026-01-01', to: '2026-06-30' }),
    ).toBe('?recordType=FORM_SUBMISSION%2CATTACHMENT&caseId=case-1&from=2026-01-01&to=2026-06-30');
  });

  it('requiresSignatureOnly 僅在 true 時輸出', () => {
    expect(trailQuery({ requiresSignatureOnly: true })).toBe('?requiresSignatureOnly=true');
    expect(trailQuery({ requiresSignatureOnly: false })).toBe('');
  });

  it('signedOff=false 照常輸出（簽核缺口查詢）；null/undefined 略過', () => {
    expect(trailQuery({ signedOff: false })).toBe('?signedOff=false');
    expect(trailQuery({ signedOff: true })).toBe('?signedOff=true');
    expect(trailQuery({ signedOff: null })).toBe('');
  });
});

describe('exportQuery / 匯出連結', () => {
  it('僅帶後端 export 支援的四項過濾（日期與簽核參數不上匯出端點）', () => {
    expect(
      exportQuery({
        recordType: 'LOGIN',
        documentKind: 'LOGIN_AUDIT',
        caseId: 'c1',
        projectId: 'p1',
        from: '2026-01-01',
        to: '2026-06-30',
        requiresSignatureOnly: true,
        signedOff: false,
      }),
    ).toBe('?recordType=LOGIN&documentKind=LOGIN_AUDIT&caseId=c1&projectId=p1');
  });

  it('匯出連結指向 /iso-trail/export(.csv) 並帶過濾', () => {
    expect(exportJsonUrl({ caseId: 'c1' })).toMatch(/\/iso-trail\/export\?caseId=c1$/);
    expect(exportCsvUrl({})).toMatch(/\/iso-trail\/export\.csv$/);
  });
});

describe('filterToQuery', () => {
  it('空過濾狀態 → 全空查詢', () => {
    expect(trailQuery(filterToQuery(EMPTY_TRAIL_FILTER))).toBe('');
  });

  it('UI 狀態映射：去頭尾空白、sign=gap → requiresSignatureOnly + signedOff=false', () => {
    const q = filterToQuery({
      ...EMPTY_TRAIL_FILTER,
      caseId: '  case-9 ',
      sign: 'gap',
    });
    expect(q.caseId).toBe('case-9');
    expect(q.requiresSignatureOnly).toBe(true);
    expect(q.signedOff).toBe(false);
  });
});
