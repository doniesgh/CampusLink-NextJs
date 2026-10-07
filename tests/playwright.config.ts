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
  PUSH_OUTBOX_FILE,
  RATE_LIMIT_AUTH_MAX,
  RATE_LIMIT_IP_MAX,
  RATE_LIMIT_RESET_MAX,
  SECURITY_API_PORT,
  SECURITY_API_URL,
  SECURITY_MONGO_URI,
  STORAGE_DIR,
  TEST_VAPID,
  TMP_DIR,
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
 * 3. a second backend on 4101 with rate limiting on (only when api/security.spec.ts can run),
 * 4. the Next.js app (skipped when only the "api" project runs without api/security.spec.ts).
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
// Positional arguments of `playwright test` (file filters such as "api/admin.spec.ts").
const fileFilters = (() => {
  const valueOptions = new Set(['-c', '--config', '-g', '--grep', '-G', '--grep-invert', '--project', '-j', '--workers',
    '--reporter', '--retries', '--timeout', '--global-timeout', '--max-failures', '--output', '--repeat-each', '--shard',
    '--trace', '--tsconfig']);
  const start = process.argv.indexOf('test');
  if (start === -1) return [];
  const args = process.argv.slice(start + 1);
  return args.filter((arg, i) => !arg.startsWith('-') && !valueOptions.has(args[i - 1]) && !selectedProjects.includes(arg));
})();
const runsProject = (name: string) => selectedProjects.length === 0 || selectedProjects.includes(name);
const needsE2e = runsProject('e2e');
// api/security.spec.ts also checks the web app (BFF, redirects, headers) and uses a second backend.
const needsSecurity = runsProject('api') && (fileFilters.length === 0 || fileFilters.some((f) => /security/i.test(f)));
const needsWeb = needsE2e || selectedProjects.some((name) => name !== 'api' && name !== 'e2e') || needsSecurity;
// Read by global-setup.ts (same process) to decide whether to warm up the Next.js pages in a browser.
process.env.CAMPUSLINK_TEST_WEB = needsE2e ? '1' : '0';

/** Phase-1 settings shared by both backends. Values set here take precedence over backend/.env. */
const phase1BackendEnv = {
  APP_TIMEZONE: 'Africa/Tunis',
  TRUST_PROXY: 'loopback',
  // Uploads, pushes and emails stay in tests/.tmp (reset by scripts/test-db.mjs).
  STORAGE_DIR,
  MAX_UPLOAD_MB: '10',
  PUSH_OUTBOX_FILE,
  SCHEDULER_INTERVAL_MS: '1000',
  NOTIFY_HORIZON_DAYS: '14',
  RATE_LIMIT_WINDOW_MS: '900000',
};

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
        ...phase1BackendEnv,
        PUBLIC_API_URL: API_URL,
        // Rate limiting is tested on the security backend only (the suite logs in many times).
        RATE_LIMIT_ENABLED: 'false',
        // Empty values override the developer's keys in backend/.env: push stays disabled (503 PUSH_DISABLED).
        VAPID_PUBLIC_KEY: '',
        VAPID_PRIVATE_KEY: '',
      },
    },
    ...(needsSecurity
      ? [
          {
            // Second backend for api/security.spec.ts: own database, rate limiting ON, test VAPID keys.
            name: 'backend-security',
            command: 'node app.js',
            cwd: BACKEND_DIR,
            url: `${SECURITY_API_URL}/api/health`,
            timeout: 60_000,
            reuseExistingServer: false,
            env: {
              PORT: String(SECURITY_API_PORT),
              MONGO_URI: SECURITY_MONGO_URI,
              JWT_SECRET,
              JWT_ACCESS_TTL: `${ACCESS_TOKEN_TTL_SECONDS}s`,
              CORS_ORIGINS: WEB_URL,
              APP_URL: WEB_URL,
              MAIL_OUTBOX_FILE: `${TMP_DIR}/outbox-security.jsonl`,
              SMTP_USER: '',
              SMTP_PASS: '',
              ...phase1BackendEnv,
              PUSH_OUTBOX_FILE: `${TMP_DIR}/push-outbox-security.jsonl`,
              PUBLIC_API_URL: SECURITY_API_URL,
              RATE_LIMIT_ENABLED: 'true',
              RATE_LIMIT_AUTH_MAX: String(RATE_LIMIT_AUTH_MAX),
              RATE_LIMIT_IP_MAX: String(RATE_LIMIT_IP_MAX),
              RATE_LIMIT_RESET_MAX: String(RATE_LIMIT_RESET_MAX),
              VAPID_PUBLIC_KEY: TEST_VAPID.publicKey,
              VAPID_PRIVATE_KEY: TEST_VAPID.privateKey,
              VAPID_SUBJECT: 'mailto:security-tests@campuslink.test',
            },
          },
        ]
      : []),
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
