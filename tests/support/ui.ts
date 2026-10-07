import { expect, type BrowserContext, type Page } from '@playwright/test';

/** Session cookie names set by the Next.js app (see next/README.md). */
export const ACCESS_COOKIE = 'cl_access';
export const REFRESH_COOKIE = 'cl_refresh';

/**
 * The page's own alert. Next.js also renders a hidden route announcer with role="alert",
 * so alerts are looked up inside <main>.
 */
export const formAlert = (page: Page) => page.getByRole('main').getByRole('alert');
export const formStatus = (page: Page) => page.getByRole('main').getByRole('status');

export async function fillLogin(page: Page, email: string, password: string, { remember = false } = {}) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  if (remember) await page.getByLabel('Keep me signed in').check();
}

/** Logs in through /login and waits for the dashboard. */
export async function loginViaUi(page: Page, email: string, password: string, firstname: string) {
  await page.goto('/login');
  await fillLogin(page, email, password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expectDashboard(page, firstname);
}

export async function expectDashboard(page: Page, firstname: string) {
  await expect(page).toHaveURL((url) => url.pathname === '/dashboard');
  await expect(page.getByRole('heading', { level: 1, name: `Welcome, ${firstname}` })).toBeVisible();
}

/** Expects the current URL to be /login?next=<next>. */
export async function expectLoginRedirect(page: Page, next: string) {
  await expect(page).toHaveURL((url) => url.pathname === '/login' && url.searchParams.get('next') === next);
}

export async function getCookie(context: BrowserContext, name: string) {
  return (await context.cookies()).find((cookie) => cookie.name === name);
}
