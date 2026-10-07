import { chromium } from '@playwright/test';
import { DEFAULT_PASSWORD, uniqueEmail } from './support/accounts';
import { API_URL, WEB_URL } from './support/env';

const warn = (step: string, error: unknown) =>
  console.warn(`[global-setup] Warm-up step "${step}" failed (the tests will report real problems): ${(error as Error).message}`);

// Runs once, after the webServers are up (see playwright.config.ts).
export default async function globalSetup() {
  const health = await fetch(`${API_URL}/api/health`);
  if (!health.ok) {
    throw new Error(`Backend health check failed: ${health.status} ${await health.text()}`);
  }

  if (process.env.CAMPUSLINK_TEST_WEB === '1') await warmUpWebApp();
}

/**
 * `next dev` compiles every route (server code, RSC payload and client chunks) on first use.
 * Done here once, in one browser, so tests running in parallel do not all hit a cold compiler.
 * Failures are only logged: this is an optimisation, the tests themselves report real problems.
 */
async function warmUpWebApp() {
  const routes = ['/', '/login', '/signup', '/forgot-password', '/reset-password?token=warm-up'];
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL: WEB_URL });
    page.setDefaultTimeout(180_000);

    for (const route of routes) {
      try {
        await page.goto(route, { waitUntil: 'networkidle' });
        // Payload used by client-side navigations (<Link>).
        await fetch(`${WEB_URL}${route}`, { headers: { RSC: '1' }, signal: AbortSignal.timeout(180_000) });
      } catch (error) {
        warn(route, error);
      }
    }

    // Each page's Server Action entry is compiled on its first call: run every form once.
    const email = uniqueEmail('warm-up');
    try {
      await page.goto('/signup', { waitUntil: 'networkidle' });
      await page.getByLabel('First name').fill('Warm');
      await page.getByLabel('Last name').fill('Up');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password', { exact: true }).fill(DEFAULT_PASSWORD);
      await page.getByLabel('Confirm password').fill(DEFAULT_PASSWORD);
      await page.getByRole('button', { name: 'Create account' }).click();
      await page.waitForURL((url) => url.pathname === '/dashboard');
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: 'Log out' }).click();
      await page.waitForURL((url) => url.pathname === '/login');
      await page.waitForLoadState('networkidle');

      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password', { exact: true }).fill(DEFAULT_PASSWORD);
      await page.getByRole('button', { name: 'Log in' }).click();
      await page.waitForURL((url) => url.pathname === '/dashboard');
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: 'Log out' }).click();
      await page.waitForURL((url) => url.pathname === '/login');
    } catch (error) {
      warn('signup / login / dashboard / logout', error);
    }

    try {
      await page.goto('/forgot-password', { waitUntil: 'networkidle' });
      await page.getByLabel('Email').fill(uniqueEmail('warm-up-ghost'));
      await page.getByRole('button', { name: 'Send reset link' }).click();
      await page.getByRole('main').getByRole('status').waitFor();

      await page.goto('/reset-password?token=warm-up', { waitUntil: 'networkidle' });
      await page.getByLabel('New password').fill(DEFAULT_PASSWORD);
      await page.getByLabel('Confirm password').fill(DEFAULT_PASSWORD);
      await page.getByRole('button', { name: 'Reset password' }).click();
      await page.getByRole('main').getByRole('alert').waitFor();
    } catch (error) {
      warn('forgot / reset password', error);
    }
  } finally {
    await browser.close();
  }
}
