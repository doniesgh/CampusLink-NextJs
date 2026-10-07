import { expect, test as apiTest } from './api';

/**
 * E2E test: the `api` fixture (backend client for setup) plus a browser guard that fails the test
 * on uncaught exceptions or console errors (hydration errors, failed scripts, React warnings...).
 */
export const test = apiTest.extend<{ browserErrors: string[] }>({
  browserErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
      });
      await use(errors);
      expect(errors, 'the browser reported errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
