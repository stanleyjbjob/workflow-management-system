/** lib/auth 測試（issue 8.4 #39）：loginUrl / shouldRedirectOnUnauthorized / configureAuthRedirect。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_LOGIN_PATH, configureAuthRedirect, handleUnauthorized, loginUrl, shouldRedirectOnUnauthorized } from './auth';

afterEach(() => configureAuthRedirect(null));

describe('loginUrl', () => {
  it('以 base 串接登入路徑', () => {
    expect(loginUrl('http://localhost:3000')).toBe(`http://localhost:3000${AUTH_LOGIN_PATH}`);
  });
});

describe('shouldRedirectOnUnauthorized', () => {
  it('需同時啟用且具瀏覽器環境', () => {
    expect(shouldRedirectOnUnauthorized({ enabled: true, hasWindow: true })).toBe(true);
    expect(shouldRedirectOnUnauthorized({ enabled: false, hasWindow: true })).toBe(false);
    expect(shouldRedirectOnUnauthorized({ enabled: true, hasWindow: false })).toBe(false);
  });
});

describe('handleUnauthorized', () => {
  it('可被 configureAuthRedirect 覆寫（測試環境不導向真實 window）', () => {
    const spy = vi.fn();
    configureAuthRedirect(spy);
    handleUnauthorized();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
