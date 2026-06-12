/** 通知收件匣查詢參數組裝測試（issue 8.13 #48）。 */
import { describe, expect, it } from 'vitest';
import { inboxQuery } from './api';

describe('inboxQuery', () => {
  it('無參數回傳空字串（後端預設 take=100、全部）', () => {
    expect(inboxQuery()).toBe('');
    expect(inboxQuery({})).toBe('');
  });

  it('unreadOnly 僅在 true 時輸出', () => {
    expect(inboxQuery({ unreadOnly: true })).toBe('?unreadOnly=true');
    expect(inboxQuery({ unreadOnly: false })).toBe('');
  });

  it('take 數值輸出；null 略過', () => {
    expect(inboxQuery({ take: 20 })).toBe('?take=20');
    expect(inboxQuery({ take: null })).toBe('');
  });

  it('組合 unreadOnly + take', () => {
    expect(inboxQuery({ unreadOnly: true, take: 50 })).toBe('?unreadOnly=true&take=50');
  });
});
