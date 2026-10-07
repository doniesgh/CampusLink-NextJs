# CampusLink tests (Playwright)

API tests for the Express backend and end-to-end tests for the Next.js app, written against the
API and web UI contracts.

- `api/`: backend tests through Playwright's `request` fixture, with no browser. Every response is also
  checked for the contract's global rules: JSON body, `{ error, code }` on errors, and no `password`,
  OTP, reset or `stack` key anywhere.
- `e2e/`: Chromium tests of the Next.js app. They use accessible labels and roles, and fail on browser
  console errors.
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
npm run test:api     # backend only (does not start Next.js)
npm run test:e2e     # browser tests only
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
| Backend         | `http://localhost:4100`                         | `JWT_SECRET=test-secret`, `OTP_MAX_ATTEMPTS=3`, no SMTP     |
| Next.js         | `http://localhost:3100`                         | `next dev`, with `API_URL=http://localhost:4100`            |

Environment variables passed to the backend take precedence over `backend/.env`, so your own
database and secrets are never used. Emails are not sent: the backend writes them to
`tests/.tmp/outbox.jsonl` (`MAIL_OUTBOX_FILE`), and the tests read OTP codes and reset links from that
file. Admin accounts are created with the backend's own `create-admin` script.

The backend still appends its audit log to `backend/logs/operations.log` during a run (that file is git-ignored).

## Troubleshooting

- **"Another next dev server is already running"**: Next.js 16 allows only one `next dev` per project
  folder. Stop your own `npm run dev` in `next/`, or test a production build instead:
  `E2E_NEXT_MODE=start npm run test:e2e` (runs `next build` + `next start` on port 3100).
- **"http://localhost:4100 is already used"**: a previous run did not stop cleanly. Stop the process
  listening on 27018, 4100 or 3100.
- **Slow first run**: `next dev` compiles pages on demand. `global-setup.ts` opens every page once before
  the tests start.
- **`npx playwright install chromium` times out**: retry with a longer timeout, for example
  `PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=300000 npx playwright install chromium`.
