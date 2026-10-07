import { uniqueEmail } from '../support/accounts';
import { expect, expectError, expectUser, test } from '../support/api';

test.describe('GET /api/users/me', () => {
  test('returns the current user', async ({ api }) => {
    const account = await api.signup({ firstname: 'Maya', lastname: 'Trabelsi' });

    const res = await api.get('/api/users/me', { token: account.accessToken });
    expect(res.status).toBe(200);
    expectUser(res.body, {
      id: account.user.id,
      firstname: 'Maya',
      lastname: 'Trabelsi',
      email: account.email,
      role: 'STUDENT',
      twoFactorEnabled: false,
    });
  });
});

test.describe('PATCH /api/users/me', () => {
  test('updates firstname and lastname', async ({ api }) => {
    const account = await api.signup({ firstname: 'Old', lastname: 'Name' });

    const res = await api.patch('/api/users/me', { firstname: 'New', lastname: 'Surname' }, { token: account.accessToken });
    expect(res.status).toBe(200);
    expectUser(res.body, { id: account.user.id, firstname: 'New', lastname: 'Surname', email: account.email });

    const me = await api.get('/api/users/me', { token: account.accessToken });
    expect(me.body).toMatchObject({ firstname: 'New', lastname: 'Surname' });
  });

  test('ignores role, email and password: a student cannot escalate their role', async ({ api }) => {
    const account = await api.signup({ firstname: 'Eve' });

    const res = await api.patch(
      '/api/users/me',
      { firstname: 'Evelyn', role: 'ADMIN', email: uniqueEmail('hijack'), password: 'Hijacked-Passw0rd' },
      { token: account.accessToken }
    );
    expect(res.status).toBe(200);
    expectUser(res.body, { firstname: 'Evelyn', role: 'STUDENT', email: account.email });

    // Still a student, everywhere.
    expectError(await api.get('/api/users', { token: account.accessToken }), 403, 'FORBIDDEN');
    const refreshed = await api.post('/api/auth/refresh', { refreshToken: account.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.user.role).toBe('STUDENT');

    // The password did not change.
    await api.login(account.email, account.password);
    expectError(await api.post('/api/auth/login', { email: account.email, password: 'Hijacked-Passw0rd' }), 401, 'INVALID_CREDENTIALS');
  });

  test('400 NO_CHANGES when no allowed field is given', async ({ api }) => {
    const account = await api.signup();

    expectError(await api.patch('/api/users/me', {}, { token: account.accessToken }), 400, 'NO_CHANGES');
    expectError(
      await api.patch('/api/users/me', { role: 'ADMIN', email: uniqueEmail() }, { token: account.accessToken }),
      400,
      'NO_CHANGES'
    );

    const me = await api.get('/api/users/me', { token: account.accessToken });
    expect(me.body).toMatchObject({ role: 'STUDENT', email: account.email });
  });

  test('401 AUTH_REQUIRED without a token', async ({ api }) => {
    expectError(await api.patch('/api/users/me', { firstname: 'Nobody' }), 401, 'AUTH_REQUIRED');
  });
});
