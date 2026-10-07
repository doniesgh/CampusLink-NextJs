import { expect, expectError, expectSession, test } from '../support/api';
import { JWT_SECRET } from '../support/env';
import { expiredAccessToken, signJwt } from '../support/jwt';

test.describe('Access token checks (GET /api/users/me)', () => {
  test('401 AUTH_REQUIRED without an Authorization header or with a malformed one', async ({ api }) => {
    expectError(await api.get('/api/users/me'), 401, 'AUTH_REQUIRED');
    expectError(await api.get('/api/users/me', { headers: { Authorization: 'Token abc.def.ghi' } }), 401, 'AUTH_REQUIRED');
    expectError(await api.get('/api/users/me', { headers: { Authorization: 'Bearer' } }), 401, 'AUTH_REQUIRED');
  });

  test('401 INVALID_TOKEN for garbage or a token signed with another secret', async ({ api }) => {
    const account = await api.signup();

    expectError(await api.get('/api/users/me', { token: 'not-a-jwt' }), 401, 'INVALID_TOKEN');

    const now = Math.floor(Date.now() / 1000);
    const forged = signJwt({ role: 'ADMIN', sub: account.user.id, iat: now, exp: now + 600 }, 'not-the-server-secret');
    expectError(await api.get('/api/users/me', { token: forged }), 401, 'INVALID_TOKEN');

    // A tampered payload (role escalated) invalidates the signature.
    const [header, , signature] = account.accessToken.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ role: 'ADMIN', sub: account.user.id, iat: now, exp: now + 600 })).toString('base64url');
    expectError(await api.get('/api/users/me', { token: `${header}.${tamperedPayload}.${signature}` }), 401, 'INVALID_TOKEN');
  });

  test('401 TOKEN_EXPIRED for an expired access token', async ({ api }) => {
    const account = await api.signup();
    const expired = expiredAccessToken(account.user.id, 'STUDENT', JWT_SECRET);
    expectError(await api.get('/api/users/me', { token: expired }), 401, 'TOKEN_EXPIRED');
  });
});

test.describe('POST /api/auth/refresh', () => {
  test('rotates the pair: the new tokens work and the old refresh token is rejected', async ({ api }) => {
    const account = await api.signup({ firstname: 'Rami' });

    const first = await api.post('/api/auth/refresh', { refreshToken: account.refreshToken });
    expect(first.status).toBe(200);
    expectSession(first.body, { id: account.user.id, firstname: 'Rami' });
    expect(first.body.refreshToken).not.toBe(account.refreshToken);

    const me = await api.get('/api/users/me', { token: first.body.accessToken });
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(account.user.id);

    // Single use: the old refresh token is now invalid...
    expectError(await api.post('/api/auth/refresh', { refreshToken: account.refreshToken }), 401, 'INVALID_REFRESH_TOKEN');

    // ...while the new one can be used once.
    const second = await api.post('/api/auth/refresh', { refreshToken: first.body.refreshToken });
    expect(second.status).toBe(200);
    expectSession(second.body, { id: account.user.id });
  });

  test('400 MISSING_FIELDS without a refresh token, 401 INVALID_REFRESH_TOKEN for an unknown one', async ({ api }) => {
    expectError(await api.post('/api/auth/refresh', {}), 400, 'MISSING_FIELDS');
    expectError(await api.post('/api/auth/refresh', { refreshToken: 'f'.repeat(96) }), 401, 'INVALID_REFRESH_TOKEN');
  });
});

test.describe('POST /api/auth/logout', () => {
  test('revokes the refresh token, is idempotent and leaves other sessions alone', async ({ api }) => {
    const account = await api.signup();
    const otherSession = await api.login(account.email, account.password);

    const res = await api.post('/api/auth/logout', { refreshToken: account.refreshToken });
    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();

    expectError(await api.post('/api/auth/refresh', { refreshToken: account.refreshToken }), 401, 'INVALID_REFRESH_TOKEN');

    // Idempotent.
    expect((await api.post('/api/auth/logout', { refreshToken: account.refreshToken })).status).toBe(204);

    // Only that session ended.
    const other = await api.post('/api/auth/refresh', { refreshToken: otherSession.refreshToken });
    expect(other.status).toBe(200);
  });
});
