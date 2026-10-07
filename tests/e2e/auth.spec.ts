import { DEFAULT_PASSWORD, uniqueEmail } from '../support/accounts';
import { expectError } from '../support/api';
import { expect, test } from '../support/e2e';
import { WEB_URL } from '../support/env';
import {
  expectDashboard,
  expectLoginRedirect,
  fillLogin,
  formAlert,
  getCookie,
  loginViaUi,
  REFRESH_COOKIE,
} from '../support/ui';

test.describe('Signup', () => {
  test('creating an account leads to the dashboard', async ({ page }) => {
    const email = uniqueEmail('ui-signup');
    await page.goto('/signup');
    await page.getByLabel('First name').fill('Yasmine');
    await page.getByLabel('Last name').fill('Haddad');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(DEFAULT_PASSWORD);
    await page.getByLabel('Confirm password').fill(DEFAULT_PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expectDashboard(page, 'Yasmine');
    await expect(page.getByRole('main')).toContainText(/student/i);
  });

  test('mismatched passwords show an error and create no account', async ({ page, api }) => {
    const email = uniqueEmail('ui-mismatch');
    await page.goto('/signup');
    await page.getByLabel('First name').fill('Mismatch');
    await page.getByLabel('Last name').fill('Case');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(DEFAULT_PASSWORD);
    await page.getByLabel('Confirm password').fill(`${DEFAULT_PASSWORD}-different`);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(formAlert(page)).toContainText("Passwords don't match.");
    await expect(page).toHaveURL((url) => url.pathname === '/signup');
    expectError(await api.post('/api/auth/login', { email, password: DEFAULT_PASSWORD }), 401, 'INVALID_CREDENTIALS');
  });

  test('the signup page links to the login page', async ({ page }) => {
    await page.goto('/signup');
    await page.getByRole('main').getByRole('link', { name: 'Log in' }).click();
    await expect(page).toHaveURL((url) => url.pathname === '/login');
  });
});

test.describe('Login and logout', () => {
  test('login page has the expected controls and links', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Keep me signed in')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password');
    await expect(page.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/signup');
  });

  test('a wrong password shows "Incorrect email or password."', async ({ page, api }) => {
    const account = await api.signup();
    await page.goto('/login');
    await fillLogin(page, account.email, 'Wrong-Passw0rd');
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(formAlert(page)).toContainText('Incorrect email or password.');
    await expect(page).toHaveURL((url) => url.pathname === '/login');
  });

  test('valid credentials lead to the dashboard, which shows the role', async ({ page, api }) => {
    const account = await api.signup({ firstname: 'Karim' });
    await loginViaUi(page, account.email, account.password, 'Karim');
    await expect(page.getByRole('main')).toContainText(/student/i);
  });

  test('log out ends the session and returns to /login', async ({ page, context, api }) => {
    const account = await api.signup({ firstname: 'Leila' });
    await loginViaUi(page, account.email, account.password, 'Leila');
    const refreshCookie = await getCookie(context, REFRESH_COOKIE);
    expect(refreshCookie, 'refresh cookie after login').toBeDefined();

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL((url) => url.pathname === '/login');

    // The backend session was revoked (POST /api/auth/logout) and the cookies are gone.
    expectError(await api.post('/api/auth/refresh', { refreshToken: refreshCookie!.value }), 401, 'INVALID_REFRESH_TOKEN');
    await page.goto('/dashboard');
    await expectLoginRedirect(page, '/dashboard');
  });

  test('"Keep me signed in" keeps the refresh cookie after the browser closes; otherwise it is a session cookie', async ({
    page,
    context,
    api,
  }) => {
    const account = await api.signup({ firstname: 'Remy' });

    await page.goto('/login');
    await fillLogin(page, account.email, account.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expectDashboard(page, 'Remy');
    expect((await getCookie(context, REFRESH_COOKIE))?.expires, 'session cookie').toBe(-1);

    await context.clearCookies();
    await page.goto('/login');
    await fillLogin(page, account.email, account.password, { remember: true });
    await page.getByRole('button', { name: 'Log in' }).click();
    await expectDashboard(page, 'Remy');
    const expires = (await getCookie(context, REFRESH_COOKIE))?.expires ?? -1;
    expect(expires * 1000, 'persistent cookie (days, not a browser session)').toBeGreaterThan(Date.now() + 7 * 24 * 3600 * 1000);
  });
});

test.describe('Route protection', () => {
  test('unauthenticated /dashboard redirects to /login?next=/dashboard, and back after login', async ({ page, api }) => {
    const account = await api.signup({ firstname: 'Nadia' });

    await page.goto('/dashboard');
    await expectLoginRedirect(page, '/dashboard');

    await fillLogin(page, account.email, account.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expectDashboard(page, 'Nadia');
  });

  test('"next" is followed when it is a safe relative path, ignored otherwise', async ({ page, context, api }) => {
    const account = await api.signup({ firstname: 'Omar' });

    await page.goto(`/login?next=${encodeURIComponent('/dashboard?from=e2e')}`);
    await fillLogin(page, account.email, account.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL((url) => url.pathname === '/dashboard' && url.searchParams.get('from') === 'e2e');

    for (const unsafe of ['//evil.example/phish', 'https://evil.example/phish']) {
      await context.clearCookies();
      await page.goto(`/login?next=${encodeURIComponent(unsafe)}`);
      await fillLogin(page, account.email, account.password);
      await page.getByRole('button', { name: 'Log in' }).click();
      await expectDashboard(page, 'Omar');
      expect(new URL(page.url()).origin).toBe(WEB_URL);
    }
  });

  test('a signed-in user visiting /login or /signup is sent to /dashboard', async ({ page, api }) => {
    const account = await api.signup({ firstname: 'Sofia' });
    await loginViaUi(page, account.email, account.password, 'Sofia');

    await page.goto('/login');
    await expectDashboard(page, 'Sofia');
    await page.goto('/signup');
    await expectDashboard(page, 'Sofia');
  });
});
