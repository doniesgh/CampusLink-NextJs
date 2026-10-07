import { uniqueEmail } from '../support/accounts';
import { expect, expectError, expectSession, test } from '../support/api';

test.describe('POST /api/auth/login', () => {
  test('returns a session for valid credentials', async ({ api }) => {
    const account = await api.signup({ firstname: 'Lina' });

    const res = await api.post('/api/auth/login', { email: account.email, password: account.password });
    expect(res.status).toBe(200);
    expectSession(res.body, { id: account.user.id, email: account.email, firstname: 'Lina', role: 'STUDENT' });
    // Each login opens a new session with its own refresh token.
    expect(res.body.refreshToken).not.toBe(account.refreshToken);

    const me = await api.get('/api/users/me', { token: res.body.accessToken });
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(account.user.id);
  });

  test('401 INVALID_CREDENTIALS for a wrong password and for an unknown email (same answer)', async ({ api }) => {
    const account = await api.signup();

    const wrongPassword = await api.post('/api/auth/login', { email: account.email, password: 'Wrong-Passw0rd' });
    expectError(wrongPassword, 401, 'INVALID_CREDENTIALS');

    const unknownEmail = await api.post('/api/auth/login', { email: uniqueEmail('nobody'), password: 'Wrong-Passw0rd' });
    expectError(unknownEmail, 401, 'INVALID_CREDENTIALS');

    // No account enumeration: both answers are identical.
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });

  test('400 MISSING_FIELDS without email or password', async ({ api }) => {
    const noPassword = await api.post('/api/auth/login', { email: uniqueEmail() });
    expectError(noPassword, 400, 'MISSING_FIELDS');
    expect(noPassword.body.details.fields).toEqual(['password']);

    expectError(await api.post('/api/auth/login', {}), 400, 'MISSING_FIELDS');
  });
});
