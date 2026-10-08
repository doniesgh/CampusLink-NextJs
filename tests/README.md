# CampusLink tests (Playwright)

API tests for the Express backend and end-to-end tests for the Next.js app, written against the
API and web UI contracts.

- `api/`: backend tests through Playwright's `request` fixture, with no browser. Every response is also
  checked for the contract's global rules: JSON body, `{ error, code }` on errors, and no `password`,
  OTP, reset or `stack` key anywhere.
- `api/security.spec.ts`: short phase-1 security checks (authorization, IDOR, mass assignment, uploads,
  NoSQL/regex injection, push endpoint SSRF, secret leaks, auth rate limiting (per email, and per client IP
  only for forwarded addresses, not for loopback without `X-Forwarded-For`), and the web app's BFF,
  `?next=` redirects, security headers, client `X-Forwarded-For` (BFF and a Server Action, in a browser),
  `Clear-Site-Data` at the end of a session and the service worker's page-saving rules). Its `phase 2` block covers
  bookings, the forum, attendance, grades and analytics: role checks on every new endpoint (401 / 403, another
  teacher's session or class), IDOR (another user's booking, records, grades, analytics or PDF report, hidden forum
  content, unpublished grades), mass assignment, concurrent double booking and stale versions (409), per-user rate
  limits of booking creations and cancellations (security backend), one admin notification per requester every 10
  minutes, the grades audit trail (a teacher cannot delete a published assessment), NoSQL / regex injection,
  plain-text forum content in the web page, the group comparison (every figure from at least 5 students) and a final
  scan of every phase 2 answer (no email, raw id, snapshot or internal field). Its `phase 3` block covers the
  real-time layer, carpooling, the notes marketplace and the alumni network: Socket.IO handshakes (missing,
  malformed, expired, replayed or forged tickets and tokens, foreign `Origin`, 20 connections per account, 16 KB
  messages), a ticket is useless on the REST API, `trip:<id>` rooms and their `chat:message` only for the driver and
  the accepted passengers, `notification:new` only for its recipient, connections closed when their session ends
  (password change, logout of that session only, role change, session ended elsewhere), exact trip coordinates only for participants (detail, search, history, web page), concurrent seat accepts and
  cancellations, premium files and unpublished documents (404), concurrent purchases (no double charge, never below
  zero), wallets, reviews, PRIVATE alumni profiles and consent, e-mails only inside an accepted mentoring request, the
  GDPR export and erasure (also when an admin deletes the account, whose open connections are closed too),
  plain-text posts and https links, role checks, mass assignment, NoSQL / regex injection,
  the phase 3 per-user rate limits (security backend), the BFF (tickets, premium files, cross-site writes) and a final
  scan of every phase 3 answer. The real-time checks use the web app's own `socket.io-client` (`next/node_modules`).
  A failing test there is a vulnerability to fix in `backend/` or `next/`, not in the test.
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
| Security backend| `http://localhost:4101`                         | only when `api/security.spec.ts` runs: own database, `RATE_LIMIT_AUTH_MAX=3`, `RATE_LIMIT_IP_MAX=30`, `RATE_LIMIT_RESET_MAX=5`, `RATE_LIMIT_BOOKING_CREATE_MAX` / `RATE_LIMIT_BOOKING_CANCEL_MAX=5` per hour, phase 3 per-user limits at 3 (real-time tickets, carpool trips / requests / messages, marketplace uploads / reports, alumni posts / mentoring requests), test VAPID keys |
| Next.js         | `http://localhost:3100`                         | `next dev`, with `API_URL=http://localhost:4100` and `NEXT_PUBLIC_REALTIME_URL=http://localhost:4100` (skipped for api-only runs without the security spec) |

Both backends also get the phase 3 contract defaults (`CAMPUS_LAT`, `CAMPUS_LNG`, `CAMPUS_LABEL`,
`CARPOOL_SEARCH_RADIUS_KM`, `CARPOOL_COST_PER_KM`, `MARKET_STARTING_TOKENS`, `MARKET_HOLD_TIMEOUT_MS`), whatever
`backend/.env` says. Socket.IO runs on the backend's own port (path `/socket.io`).

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
  3100; `NEXT_DIST_DIR` keeps your own `.next` build untouched). Such a run adds `.next-e2e/...` lines to
  `next/tsconfig.json` and rewrites the imports of `next/next-env.d.ts`: restore both and delete the folder
  afterwards. The same variables also work for `npm test` (the whole suite against one production build).
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
