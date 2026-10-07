import { expect, test } from '../support/e2e';

const ALLOWED_TARGETS = ['/', '/#modules', '/#offline', '/login', '/signup'];

test.describe('Landing page', () => {
  test('loads, and header/footer links only target existing routes and sections', async ({ page, request }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/CampusLink/);

    const header = page.getByRole('banner');
    const footer = page.getByRole('contentinfo');
    await expect(header).toBeVisible();
    await expect(footer).toBeVisible();

    const hrefs = [
      ...(await header.locator('a[href]').evaluateAll((links) => links.map((link) => link.getAttribute('href')))),
      ...(await footer.locator('a[href]').evaluateAll((links) => links.map((link) => link.getAttribute('href')))),
    ];
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(ALLOWED_TARGETS, `link to "${href}"`).toContain(href);

    // Every other internal link of the page (hero, call-to-action) also points to an existing target.
    const allInternal = await page
      .locator('a[href^="/"], a[href^="#"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
    for (const href of allInternal) {
      const normalized = href.startsWith('#') ? `/${href}` : href;
      expect(ALLOWED_TARGETS, `link to "${href}"`).toContain(normalized);
    }

    // The anchors exist on the page and the routes answer 200.
    await expect(page.locator('#modules')).toHaveCount(1);
    await expect(page.locator('#offline')).toHaveCount(1);
    for (const route of ['/', '/login', '/signup']) {
      expect((await request.get(route)).status(), route).toBe(200);
    }
  });

  test('header links lead to the login and signup pages', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('banner').getByRole('link', { name: 'Log in' }).click();
    await expect(page).toHaveURL((url) => url.pathname === '/login');
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();

    await page.goto('/');
    await page.getByRole('banner').getByRole('link', { name: 'Sign up' }).click();
    await expect(page).toHaveURL((url) => url.pathname === '/signup');
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
  });

  test('mobile menu only links to existing routes and sections', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Open menu' }).click();
    const menu = page.getByRole('dialog');
    await expect(menu).toBeVisible();

    const hrefs = await menu.locator('a[href]').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(ALLOWED_TARGETS, `link to "${href}"`).toContain(href);
  });
});
