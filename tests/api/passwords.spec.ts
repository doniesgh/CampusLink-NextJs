import { uniqueEmail } from '../support/accounts';
import type { Api, Account } from '../support/api';
import { expect, expectError, test } from '../support/api';
import { WEB_URL } from '../support/env';
import { extractResetLink, mailsTo, waitForMail } from '../support/outbox';

/** Asks for a reset link and returns the token emailed to the account. */
async function requestResetToken(api: Api, account: Account): Promise<{ url: string; token: string }> {
  const before = mailsTo(account.email).length;
  const res = await api.post('/api/auth/forgot-password', { email: account.email });
  expect(res.status).toBe(200);
  return extractResetLink(await waitForMail(account.email, { after: before }));
}

test.describe('Forgot / reset password', () => {
  test('forgot-password gives the same answer for unknown and existing emails, and only mails real accounts', async ({ api }) => {
    const account = await api.signup();
    const unknown = uniqueEmail('ghost');

    const unknownRes = await api.post('/api/auth/forgot-password', { email: unknown });
    expect(unknownRes.status).toBe(200);
    expect(unknownRes.body).toEqual({ message: expect.any(String) });

    const knownBefore = mailsTo(account.email).length;
    const knownRes = await api.post('/api/auth/forgot-password', { email: account.email });
    expect(knownRes.status).toBe(200);
    expect(knownRes.body).toEqual(unknownRes.body);

    await waitForMail(account.email, { after: knownBefore });
    expect(mailsTo(unknown)).toHaveLength(0);
  });

  test('reset with the emailed token: new password works, old one and old sessions do not', async ({ api }) => {
    const account = await api.signup();
    const otherSession = await api.login(account.email, account.password);

    const link = await requestResetToken(api, account);
    expect(link.url.startsWith(`${WEB_URL}/reset-password?token=`)).toBe(true);

    const newPassword = 'Brand-New-Passw0rd';
    const res = await api.post('/api/auth/reset-password', { token: link.token, password: newPassword });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: expect.any(String) });

    // Every refresh token of the user was revoked.
    expectError(await api.post('/api/auth/refresh', { refreshToken: account.refreshToken }), 401, 'INVALID_REFRESH_TOKEN');
    expectError(await api.post('/api/auth/refresh', { refreshToken: otherSession.refreshToken }), 401, 'INVALID_REFRESH_TOKEN');

    expectError(await api.post('/api/auth/login', { email: account.email, password: account.password }), 401, 'INVALID_CREDENTIALS');
    await api.login(account.email, newPassword);

    // The token is single-use.
    expectError(
      await api.post('/api/auth/reset-password', { token: link.token, password: 'Yet-Another-Passw0rd' }),
      400,
      'RESET_TOKEN_INVALID'
    );
  });

  test('400 RESET_TOKEN_INVALID, MISSING_FIELDS and VALIDATION_ERROR', async ({ api }) => {
    expectError(
      await api.post('/api/auth/reset-password', { token: 'a'.repeat(64), password: 'Some-Passw0rd' }),
      400,
      'RESET_TOKEN_INVALID'
    );

    const missing = await api.post('/api/auth/reset-password', { token: 'a'.repeat(64) });
    expectError(missing, 400, 'MISSING_FIELDS');
    expect(missing.body.details.fields).toEqual(['password']);

    const account = await api.signup();
    const link = await requestResetToken(api, account);
    const short = await api.post('/api/auth/reset-password', { token: link.token, password: 'short' });
    expectError(short, 400, 'VALIDATION_ERROR');
    // The password was not changed.
    await api.login(account.email, account.password);
  });
});

test.describe('POST /api/auth/change-password', () => {
  test('changes the password and revokes every refresh token of the user', async ({ api }) => {
    const account = await api.signup();
    const otherSession = await api.login(account.email, account.password);
    const newPassword = 'Changed-Passw0rd';

    const res = await api.post(
      '/api/auth/change-password',
      { currentPassword: account.password, newPassword },
      { token: account.accessToken }
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: expect.any(String) });

    expectError(await api.post('/api/auth/refresh', { refreshToken: account.refreshToken }), 401, 'INVALID_REFRESH_TOKEN');
    expectError(await api.post('/api/auth/refresh', { refreshToken: otherSession.refreshToken }), 401, 'INVALID_REFRESH_TOKEN');

    expectError(await api.post('/api/auth/login', { email: account.email, password: account.password }), 401, 'INVALID_CREDENTIALS');
    await api.login(account.email, newPassword);
  });

  test('400 INVALID_PASSWORD (not 401) for a wrong current password', async ({ api }) => {
    const account = await api.signup();
    const res = await api.post(
      '/api/auth/change-password',
      { currentPassword: 'Not-My-Passw0rd', newPassword: 'Changed-Passw0rd' },
      { token: account.accessToken }
    );
    expectError(res, 400, 'INVALID_PASSWORD');

    // Nothing changed: the session and the password still work.
    expect((await api.post('/api/auth/refresh', { refreshToken: account.refreshToken })).status).toBe(200);
    await api.login(account.email, account.password);
  });

  test('400 MISSING_FIELDS / VALIDATION_ERROR, 401 AUTH_REQUIRED without a token', async ({ api }) => {
    const account = await api.signup();

    const missing = await api.post('/api/auth/change-password', { currentPassword: account.password }, { token: account.accessToken });
    expectError(missing, 400, 'MISSING_FIELDS');
    expect(missing.body.details.fields).toEqual(['newPassword']);

    expectError(
      await api.post('/api/auth/change-password', { currentPassword: account.password, newPassword: 'short' }, { token: account.accessToken }),
      400,
      'VALIDATION_ERROR'
    );

    expectError(
      await api.post('/api/auth/change-password', { currentPassword: account.password, newPassword: 'Changed-Passw0rd' }),
      401,
      'AUTH_REQUIRED'
    );

    await api.login(account.email, account.password);
  });
});
