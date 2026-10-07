import type { Api, Account } from '../support/api';
import { expect, expectError, expectSession, test } from '../support/api';
import { OTP_MAX_ATTEMPTS } from '../support/env';
import { extractOtp, mailsTo, waitForMail } from '../support/outbox';

/** A different 6-digit code than `code`. */
const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

/** Logs in an account that has 2FA on, and returns the code emailed for this login. */
async function startOtpLogin(api: Api, account: Account): Promise<string> {
  const before = mailsTo(account.email).length;
  const res = await api.post('/api/auth/login', { email: account.email, password: account.password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body).toEqual({ otpRequired: true, email: account.email });
  const mail = await waitForMail(account.email, { after: before });
  return extractOtp(mail);
}

test.describe('Two-factor login (email OTP)', () => {
  test('enable 2FA, log in with the emailed code; wrong and reused codes are refused', async ({ api }) => {
    const account = await api.signup({ firstname: 'Otto' });
    await api.enableTwoFactor(account.accessToken);

    const code = await startOtpLogin(api, account);
    expect(code).toMatch(/^\d{6}$/);

    expectError(await api.post('/api/auth/verify-otp', { email: account.email, otp: wrongCode(code) }), 400, 'OTP_INVALID');

    const res = await api.post('/api/auth/verify-otp', { email: account.email, otp: code });
    expect(res.status).toBe(200);
    expectSession(res.body, { id: account.user.id, firstname: 'Otto', twoFactorEnabled: true });

    const me = await api.get('/api/users/me', { token: res.body.accessToken });
    expect(me.status).toBe(200);

    // A code works only once.
    expectError(await api.post('/api/auth/verify-otp', { email: account.email, otp: code }), 400, 'OTP_INVALID');
  });

  test(`429 OTP_TOO_MANY_ATTEMPTS after ${OTP_MAX_ATTEMPTS} wrong codes, then the code is cleared`, async ({ api }) => {
    const account = await api.signup();
    await api.enableTwoFactor(account.accessToken);
    const code = await startOtpLogin(api, account);

    for (let attempt = 1; attempt < OTP_MAX_ATTEMPTS; attempt += 1) {
      expectError(await api.post('/api/auth/verify-otp', { email: account.email, otp: wrongCode(code) }), 400, 'OTP_INVALID');
    }
    expectError(
      await api.post('/api/auth/verify-otp', { email: account.email, otp: wrongCode(code) }),
      429,
      'OTP_TOO_MANY_ATTEMPTS'
    );

    // The pending code was cleared: even the right code is refused now.
    expectError(await api.post('/api/auth/verify-otp', { email: account.email, otp: code }), 400, 'OTP_INVALID');

    // Logging in again sends a fresh code that works.
    const freshCode = await startOtpLogin(api, account);
    const res = await api.post('/api/auth/verify-otp', { email: account.email, otp: freshCode });
    expect(res.status).toBe(200);
    expectSession(res.body, { id: account.user.id });
  });

  test('400 OTP_INVALID when no code is pending, 400 MISSING_FIELDS without email or otp', async ({ api }) => {
    const account = await api.signup();

    expectError(await api.post('/api/auth/verify-otp', { email: account.email, otp: '123456' }), 400, 'OTP_INVALID');

    const missing = await api.post('/api/auth/verify-otp', { email: account.email });
    expectError(missing, 400, 'MISSING_FIELDS');
    expect(missing.body.details.fields).toEqual(['otp']);
    expectError(await api.post('/api/auth/verify-otp', {}), 400, 'MISSING_FIELDS');
  });

  test('turning 2FA off again restores the direct login', async ({ api }) => {
    const account = await api.signup();
    await api.enableTwoFactor(account.accessToken);

    const off = await api.patch('/api/users/me', { twoFactorEnabled: false }, { token: account.accessToken });
    expect(off.status).toBe(200);
    expect(off.body.twoFactorEnabled).toBe(false);

    const before = mailsTo(account.email).length;
    const res = await api.post('/api/auth/login', { email: account.email, password: account.password });
    expect(res.status).toBe(200);
    expectSession(res.body, { id: account.user.id, twoFactorEnabled: false });
    expect(mailsTo(account.email)).toHaveLength(before);
  });
});
