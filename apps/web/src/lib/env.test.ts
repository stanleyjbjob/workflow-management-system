/** lib/env 純函式測試（issue 8.4 #39）：envFlag。 */
import { describe, expect, it } from 'vitest';
import { envFlag } from './env';

describe('envFlag', () => {
  it('未提供 / 空字串 / null / undefined 用 fallback', () => {
    expect(envFlag(undefined, true)).toBe(true);
    expect(envFlag(null, false)).toBe(false);
    expect(envFlag('', true)).toBe(true);
  });

  it('可辨識的 falsey 字串 → false', () => {
    for (const v of ['false', '0', 'no', 'off', 'FALSE', 'Off']) expect(envFlag(v, true)).toBe(false);
  });

  it('可辨識的 truthy 字串 → true', () => {
    for (const v of ['true', '1', 'yes', 'on', 'TRUE', 'On']) expect(envFlag(v, false)).toBe(true);
  });

  it('無法解析時用 fallback', () => {
    expect(envFlag('maybe', true)).toBe(true);
    expect(envFlag('maybe', false)).toBe(false);
  });
});
