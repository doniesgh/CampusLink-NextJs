import { defineConfig, devices } from '@playwright/test';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  API_PORT,
  API_URL,
  BACKEND_DIR,
  JWT_SECRET,
  MONGO_PORT,
  MONGO_URI,
  NEXT_DIR,
  OTP_MAX_ATTEMPTS,
  OUTBOX_FILE,
  WEB_PORT,
  WEB_URL,
} from './support/env';

/**
 * Two projects:
 * - "api": Playwright's request fixture against the Express backend (no browser).
 * - "e2e": Chromium against the Next.js app.
 *
 * The webServer entries start in order, each one waiting for the previous one to be ready:
 * 1. a throwaway MongoDB (mongodb-memory-server, no Docker needed),
 * 2. the backend, configured for tests (emails go to the outbox file, never to SMTP),
 * 3. the Next.js app (skipped when only the "api" project runs).
 * They are stopped when the run ends. Development ports (3000 / 4000 / 27017) are never used.
 *
 * E2E_NEXT_MODE=start runs `next build` + `next start` instead of `next dev` (needed when your own
 * `next dev` is running: Next 16 allows only one dev server per project folder).
 */

const selectedProjects = (() => {
  const names: string[] = [];
  const argv = process.argv;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--project=')) names.push(arg.slice('--project='.length));
    else if (arg === '--project') {
      for (let j = i + 1; j < argv.length && !argv[j].startsWith('-'); j += 1) names.push(argv[j]);
    }
  }
  return names;
})();
const needsWeb = selectedProjects.length === 0 || selectedProjects.some((name) => name !== 'api');
// Read by global-setup.ts (same process) to decide whether to warm up the Next.js routes.
process.env.CAMPUSLINK_TEST_WEB = needsWeb ? '1' : '0';

const nextBin = 'node node_modules/next/dist/bin/next';
const nextCommand =
  process.env.E2E_NEXT_MODE === 'start'
    ? `${nextBin} build && ${nextBin} start --port ${WEB_PORT}`
    : `${nextBin} dev --port ${WEB_PORT}`;

export default defineConfig({
  testDir: '.',
  outputDir: './test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list'], ['html', { open: 'never', outputFolder: './playwright-report' }]],
  globalSetup: './global-setup.ts',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'api',
      testDir: './api',
      use: {
        baseURL: API_URL,
        extraHTTPHeaders: { Accept: 'application/json' },
      },
    },
    {
      name: 'e2e',
      testDir: './e2e',
      // Headroom for `next dev`, which compiles code on demand; assertions are unchanged.
      expect: { timeout: 20_000 },
      use: {
        ...devices['Desktop Chrome'],
        baseURL: WEB_URL,
        actionTimeout: 15_000,
        navigationTimeout: 60_000,
      },
    },
  ],
  webServer: [
    {
      name: 'mongodb',
      command: `node scripts/test-db.mjs ${MONGO_PORT}`,
      port: MONGO_PORT,
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      name: 'backend',
      command: 'node app.js',
      cwd: BACKEND_DIR,
      url: `${API_URL}/api/health`,
      timeout: 60_000,
      reuseExistingServer: false,
      // Environment values take precedence over backend/.env (dotenv does not override them).
      env: {
        PORT: String(API_PORT),
        MONGO_URI,
        JWT_SECRET,
        JWT_ACCESS_TTL: `${ACCESS_TOKEN_TTL_SECONDS}s`,
        REFRESH_TOKEN_TTL_DAYS: '30',
        OTP_MAX_ATTEMPTS: String(OTP_MAX_ATTEMPTS),
        CORS_ORIGINS: WEB_URL,
        APP_URL: WEB_URL,
        MAIL_OUTBOX_FILE: OUTBOX_FILE,
        // Empty SMTP credentials: emails are never really sent, only written to the outbox.
        SMTP_USER: '',
        SMTP_PASS: '',
        SMTP_FROM: 'CampusLink Tests <no-reply@campuslink.test>',
      },
    },
    ...(needsWeb
      ? [
          {
            name: 'web',
            command: nextCommand,
            cwd: NEXT_DIR,
            url: `${WEB_URL}/login`,
            // First compile (dev) or build (start) can be slow.
            timeout: 300_000,
            reuseExistingServer: false,
            env: {
              API_URL,
              COOKIE_SECURE: 'false',
              NEXT_TELEMETRY_DISABLED: '1',
            },
          },
        ]
      : []),
  ],
});
