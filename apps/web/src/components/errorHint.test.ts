/** components/errorHint 純函式測試（issue 8.4 #39）。 */
import { describe, expect, it } from 'vitest';
import { errorHint } from './errorHint';

describe('errorHint', () => {
  it('401 / 403 / 0 各有對應提示', () => {
    expect(errorHint(401)).toContain('登入');
    expect(errorHint(403)).toContain('權限');
    expect(errorHint(0)).toContain('連線');
  });

  it('其他 status 回 null', () => {
    expect(errorHint(404)).toBeNull();
    expect(errorHint(500)).toBeNull();
    expect(errorHint(-1)).toBeNull();
  });
});
