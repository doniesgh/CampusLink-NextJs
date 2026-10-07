import { expectError } from '../support/api';
import { expect, test } from '../support/e2e';
import { JWT_SECRET, WEB_URL } from '../support/env';
import { expiredAccessToken } from '../support/jwt';
import { ACCESS_COOKIE, expectDashboard, expectLoginRedirect, getCookie, loginViaUi, REFRESH_COOKIE } from '../support/ui';

test.describe('Session refresh', () => {
  test('an expired access token is refreshed transparently with the refresh cookie', async ({ page, context, api }) => {
    const account = await api.signup({ firstname: 'Hedi' });
    await loginViaUi(page, account.email, account.password, 'Hedi');
    const oldRefresh = (await getCookie(context, REFRESH_COOKIE))?.value;
    expect(oldRefresh).toBeTruthy();

    // Replace the access cookie with an expired (but correctly signed) token.
    await context.addCookies([
      {
        name: ACCESS_COOKIE,
        value: expiredAccessToken(account.user.id, 'STUDENT', JWT_SECRET),
        url: WEB_URL,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);

    await page.goto('/dashboard');
    await expectDashboard(page, 'Hedi');

    // The refresh token was rotated: the browser holds a new one, the old one is dead.
    const newRefresh = (await getCookie(context, REFRESH_COOKIE))?.value;
    expect(newRefresh).toBeTruthy();
    expect(newRefresh).not.toBe(oldRefresh);
    expectError(await api.post('/api/auth/refresh', { refreshToken: oldRefresh }), 401, 'INVALID_REFRESH_TOKEN');
  });

  test('a missing access cookie is restored from the refresh cookie', async ({ page, context, api }) => {
    const account = await api.signup({ firstname: 'Amel' });
    await loginViaUi(page, account.email, account.password, 'Amel');

    await context.clearCookies({ name: ACCESS_COOKIE });
    await page.goto('/dashboard');
    await expectDashboard(page, 'Amel');
    expect(await getCookie(context, ACCESS_COOKIE)).toBeDefined();
  });

  test('a revoked session sends the user back to the login page', async ({ page, context, api }) => {
    const account = await api.signup({ firstname: 'Walid' });
    await loginViaUi(page, account.email, account.password, 'Walid');

    // Changing the password elsewhere revokes every refresh token of the account.
    const res = await api.post(
      '/api/auth/change-password',
      { currentPassword: account.password, newPassword: 'Changed-Elsewhere-1' },
      { token: account.accessToken }
    );
    expect(res.status).toBe(200);

    await context.clearCookies({ name: ACCESS_COOKIE });
    await page.goto('/dashboard');
    await expectLoginRedirect(page, '/dashboard');
  });
});
