import type { Page } from '@playwright/test';
import { expect, test } from '../support/e2e';
import { expectDashboard, loginViaUi } from '../support/ui';

/**
 * Offline copies on a shared computer: the service worker never keeps the admin pages, and a saved page is only
 * served while its owner's session cookies exist (next/public/sw.js, `cl_owner` cookie).
 * The service worker only runs in production builds: run with E2E_NEXT_MODE=start.
 */

/** Paths of the pages saved by the service worker (Cache Storage "campuslink-pages-*"). */
const savedPaths = (page: Page) =>
  page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys()) {
      if (!name.startsWith('campuslink-pages')) continue;
      for (const request of await (await caches.open(name)).keys()) paths.push(new URL(request.url).pathname);
    }
    return paths;
  });

test.describe('Offline copies and the end of a session', () => {
  test.skip(process.env.E2E_NEXT_MODE !== 'start', 'the service worker only runs in production builds (E2E_NEXT_MODE=start)');

  test('admin pages are never served offline, and saved pages are not served once the session cookies are gone', async ({
    page,
    context,
    adminCredentials,
    browserErrors,
  }) => {
    const usersPage = `/dashboard/admin/users?q=${encodeURIComponent(adminCredentials.email)}`;
    await loginViaUi(page, adminCredentials.email, adminCredentials.password, 'Ada');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    await page.goto(usersPage);
    await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
    await expect(page.getByRole('main').getByRole('cell', { name: adminCredentials.email })).toBeVisible();

    await page.goto('/dashboard');
    await expectDashboard(page, 'Ada');
    await expect.poll(() => savedPaths(page)).toContain('/dashboard');
    expect(await savedPaths(page)).not.toContain('/dashboard/admin/users');

    // While the session exists, the saved dashboard is served offline; the admin page is not.
    await context.setOffline(true);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome, Ada' })).toBeVisible();
    await page.goto(usersPage);
    await expect(page.getByRole('heading', { level: 1, name: "You're offline" })).toBeVisible();
    await expect(page.getByText(adminCredentials.email)).toHaveCount(0);
    await context.setOffline(false);

    // The session ends without "Log out" (cookies gone, e.g. the browser was closed), then the network goes.
    await context.clearCookies();
    await context.setOffline(true);
    await page.goto(usersPage);
    await expect(page.getByRole('heading', { level: 1, name: "You're offline" })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Users' })).toHaveCount(0);
    await expect(page.getByText(adminCredentials.email)).toHaveCount(0);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1, name: "You're offline" })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Welcome, Ada' })).toHaveCount(0);
    await expect(page.getByText(adminCredentials.email)).toHaveCount(0);
    expect(await savedPaths(page)).not.toContain('/dashboard');
    await context.setOffline(false);

    // Going offline on purpose makes Next.js link prefetches fail: those console errors are expected here.
    const others = browserErrors.filter((error) => !/Failed to load resource: net::ERR_INTERNET_DISCONNECTED/.test(error));
    browserErrors.splice(0, browserErrors.length, ...others);
  });
});
