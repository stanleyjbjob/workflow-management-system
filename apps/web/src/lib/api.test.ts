/**
 * lib/api 純函式測試（issue 8.2 #34）：buildQuery / toErrorBody。
 * fetch 相依之 request 流程不在此測（屬整合測試範疇，見 issue 9.1/9.2）。
 */
import { describe, expect, it } from 'vitest';
import { buildQuery, toErrorBody } from './api';

describe('buildQuery', () => {
  it('序列化一般參數並以 ? 開頭', () => {
    expect(buildQuery({ role: 'SALES', n: 3 })).toBe('?role=SALES&n=3');
  });

  it('略過 null / undefined / 空字串', () => {
    expect(buildQuery({ a: null, b: undefined, c: '', d: 'x' })).toBe('?d=x');
  });

  it('全部略過時回傳空字串（不帶 ?）', () => {
    expect(buildQuery({ a: null, b: '' })).toBe('');
    expect(buildQuery({})).toBe('');
  });

  it('false 與 0 照常輸出（與「未提供」區分）', () => {
    expect(buildQuery({ flag: false, zero: 0 })).toBe('?flag=false&zero=0');
  });

  it('Date 轉 ISO 字串', () => {
    const d = new Date('2026-06-07T00:00:00.000Z');
    expect(buildQuery({ now: d })).toBe(`?now=${encodeURIComponent('2026-06-07T00:00:00.000Z')}`);
  });
});

describe('toErrorBody', () => {
  it('保留後端自訂 {code,message}（guard() 慣例）', () => {
    expect(toErrorBody(400, { code: 'invalid_query', message: 'now 不是合法日期' })).toEqual({
      code: 'invalid_query',
      message: 'now 不是合法日期',
    });
  });

  it('Nest 預設格式（無 code）依 status 補 fallback code', () => {
    expect(toErrorBody(401, { statusCode: 401, message: 'Unauthorized' })).toEqual({
      code: 'unauthorized',
      message: 'Unauthorized',
    });
    expect(toErrorBody(403, { statusCode: 403, message: 'Forbidden' }).code).toBe('forbidden');
    expect(toErrorBody(404, {}).code).toBe('not_found');
    expect(toErrorBody(500, {}).code).toBe('http_500');
  });

  it('message 為陣列時合併（class-validator 慣例）', () => {
    expect(toErrorBody(400, { message: ['a 必填', 'b 必填'] }).message).toBe('a 必填; b 必填');
  });

  it('非 JSON 文字與空 body 容錯', () => {
    expect(toErrorBody(502, 'Bad Gateway')).toEqual({ code: 'http_502', message: 'Bad Gateway' });
    expect(toErrorBody(500, null)).toEqual({ code: 'http_500', message: 'HTTP 500' });
  });
});
