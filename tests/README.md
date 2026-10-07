# CampusLink tests (Playwright)

API tests for the Express backend and end-to-end tests for the Next.js app, written against the
API and web UI contracts.

- `api/`: backend tests through Playwright's `request` fixture, with no browser. Every response is also
  checked for the contract's global rules: JSON body, `{ error, code }` on errors, and no `password`,
  OTP, reset or `stack` key anywhere.
- `api/security.spec.ts`: short phase-1 security checks (authorization, IDOR, mass assignment, uploads,
  NoSQL/regex injection, push endpoint SSRF, secret leaks, login rate limiting, and the web app's BFF,
  `?next=` redirects, security headers, client `X-Forwarded-For` (BFF and a Server Action, in a browser),
  `Clear-Site-Data` at the end of a session and the service worker's page-saving rules). A failing test there
  is a vulnerability to fix in `backend/` or `next/`, not in the test.
- `e2e/`: Chromium tests of the Next.js app. They use accessible labels and roles, and fail on browser
  console errors. `e2e/offline-privacy.spec.ts` needs the service worker, so it only runs with
  `E2E_NEXT_MODE=start` (it is skipped otherwise).
- `support/`: shared helpers (backend client, mail outbox reader, JWT, admin creation).

## Prerequisites

- Node.js 20 or newer. Dependencies are installed in `backend/` and `next/` (`npm install` in each).
- No Docker and no local MongoDB needed: an in-memory MongoDB is started for the run.

```bash
cd tests
npm install                     # also downloads the MongoDB binary used by mongodb-memory-server
npx playwright install chromium
```

## Run

```bash
npm test             # everything
npm run test:api     # backend tests, including api/security.spec.ts (which also starts Next.js)
npm run test:e2e     # browser tests only
npx playwright test --project=api api/security.spec.ts   # security checks only
npm run report       # open the HTML report of the last run
npm run typecheck    # type-check the test code
```

Run one file or one test with `npx playwright test api/admin.spec.ts` or `npx playwright test -g "2FA"`.
Add `--headed` or `--ui` to watch the browser.

## What starts during a run

`playwright.config.ts` starts these servers in order and stops them at the end of the run.
Development ports (3000, 4000, 27017) are never used.

| Server          | Address                                         | Notes                                                       |
| --------------- | ----------------------------------------------- | ----------------------------------------------------------- |
| MongoDB         | `mongodb://127.0.0.1:27018/campuslink-test`     | `scripts/test-db.mjs`; empty for every run                  |
| Backend         | `http://localhost:4100`                         | `JWT_SECRET=test-secret`, `OTP_MAX_ATTEMPTS=3`, no SMTP, rate limiting off, push disabled |
| Security backend| `http://localhost:4101`                         | only when `api/security.spec.ts` runs: own database, `RATE_LIMIT_AUTH_MAX=3`, test VAPID keys |
| Next.js         | `http://localhost:3100`                         | `next dev`, with `API_URL=http://localhost:4100` (skipped for api-only runs without the security spec) |

Environment variables passed to the backend take precedence over `backend/.env`, so your own
database and secrets are never used. Emails are not sent: the backend writes them to
`tests/.tmp/outbox.jsonl` (`MAIL_OUTBOX_FILE`), and the tests read OTP codes and reset links from that
file. Pushes go to `tests/.tmp/push-outbox.jsonl` (`PUSH_OUTBOX_FILE`) and uploads to `tests/.tmp/uploads`
(`STORAGE_DIR`). Admin accounts are created with the backend's own `create-admin` script.

The backend still appends its audit log to `backend/logs/operations.log` during a run (that file is git-ignored).

## Troubleshooting

- **"Another next dev server is already running"**: Next.js 16 allows only one `next dev` per project
  folder. Stop your own `npm run dev` in `next/`, or test a production build instead:
  `E2E_NEXT_MODE=start NEXT_DIST_DIR=.next-e2e npm run test:e2e` (runs `next build` + `next start` on port
  3100; `NEXT_DIST_DIR` keeps your own `.next` build untouched).
- **"available disk space ... is less than required minimum"** in the backend output: the test MongoDB
  refuses to build indexes with less than 500 MB free on the disk. Free some space first.
- **UI login/signup tests time out on a busy machine**: four browsers plus `next dev` can push a page or a
  Server Action from about 200 ms to 10-20 s. Run `npm run test:api` and `npm run test:e2e` separately, or
  add `--workers=2`.
- **"http://localhost:4100 is already used"**: a previous run did not stop cleanly. Stop the process
  listening on 27018, 4100, 4101 or 3100.
- **Slow first run**: `next dev` compiles pages on demand. `global-setup.ts` opens every page once before
  the tests start.
- **`npx playwright install chromium` times out**: retry with a longer timeout, for example
  `PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=300000 npx playwright install chromium`.
