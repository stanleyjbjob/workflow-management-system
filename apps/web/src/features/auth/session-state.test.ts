/** auth/session-state 測試（issue 8.5 #40）。 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api';
import { toSessionState } from './session-state';

const user = { sub: 'u1', email: 'a@b.com', name: 'Alice', roles: ['MANAGER'] };

describe('toSessionState', () => {
  it('成功 → authenticated', () => {
    expect(toSessionState({ ok: true, user })).toEqual({ status: 'authenticated', user });
  });
  it('401 → unauthenticated', () => {
    const r = toSessionState({ ok: false, error: new ApiError(401, 'unauthorized', '未登入') });
    expect(r).toEqual({ status: 'unauthenticated' });
  });
  it('連線失敗(status 0) → error 並保留訊息', () => {
    const r = toSessionState({ ok: false, error: new ApiError(0, 'network_error', '無法連線 API') });
    expect(r).toEqual({ status: 'error', message: '無法連線 API' });
  });
  it('5xx → error', () => {
    const r = toSessionState({ ok: false, error: new ApiError(500, 'http_500', 'HTTP 500') });
    expect(r).toEqual({ status: 'error', message: 'HTTP 500' });
  });
  it('非 Error → error 未知錯誤', () => {
    expect(toSessionState({ ok: false, error: 'boom' })).toEqual({ status: 'error', message: '未知錯誤' });
  });
});
