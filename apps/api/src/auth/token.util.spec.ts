import { signToken, verifyToken } from './token.util';

describe('token.util (HS256)', () => {
  const secret = 'unit-test-secret';

  it('簽發後可驗證並取回 payload', () => {
    const token = signToken({ sub: 'u1', roles: ['SALES'] }, secret, { expiresInSeconds: 60 });
    const payload = verifyToken<{ sub: string; roles: string[] }>(token, secret);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('u1');
    expect(payload?.roles).toEqual(['SALES']);
  });

  it('錯誤密鑰應驗證失敗', () => {
    const token = signToken({ sub: 'u1' }, secret);
    expect(verifyToken(token, 'wrong-secret')).toBeNull();
  });

  it('被竄改的 payload 應驗證失敗', () => {
    const token = signToken({ sub: 'u1' }, secret);
    const parts = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'admin' }))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const tampered = `${parts[0]}.${forged}.${parts[2]}`;
    expect(verifyToken(tampered, secret)).toBeNull();
  });

  it('過期 token 應驗證失敗', () => {
    const token = signToken({ sub: 'u1' }, secret, { expiresInSeconds: -10 });
    expect(verifyToken(token, secret)).toBeNull();
  });

  it('格式錯誤應回傳 null', () => {
    expect(verifyToken('not-a-token', secret)).toBeNull();
  });
});
