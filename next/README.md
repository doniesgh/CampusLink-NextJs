# CampusLink web (Next.js)

Next.js 16 (App Router) + React 19 + Tailwind CSS v4. Talks to the CampusLink backend (`../backend`).

## Getting started

```bash
cp .env.example .env.local   # API_URL=http://localhost:4000
npm install
npm run dev                  # http://localhost:3000
```

Checks: `npx tsc --noEmit`, `npm run lint`, `npm run build`.

## Environment (server-only)

| Variable        | Default                 | Purpose                                                                 |
| --------------- | ----------------------- | ----------------------------------------------------------------------- |
| `API_URL`       | `http://localhost:4000` | Base URL of the backend API.                                            |
| `COOKIE_SECURE` | production only         | `true`/`false` overrides the `Secure` flag of the session cookies.      |

## How authentication works

The browser never calls the backend: Server Actions (`app/actions/auth.ts`), the proxy (`proxy.ts`)
and Server Components call it through `lib/api.ts`, and the tokens live in httpOnly cookies
(`lib/session.ts`):

- `cl_access`: access token (JWT), kept for the token's lifetime.
- `cl_refresh`: refresh token, 30 days with "Keep me signed in", otherwise a browser-session cookie.
- `cl_remember`: remembers that choice for later refreshes.

`proxy.ts` (Next 16's renamed middleware) protects `/dashboard`, sends signed-in users away from
`/login` and `/signup`, and refreshes an expired access token before the page renders.

## Pages

`/` landing · `/login` (with the 2FA code step) · `/signup` · `/forgot-password` ·
`/reset-password?token=...` · `/dashboard` (protected).

## Notes for E2E tests

- Next.js adds a hidden route announcer with `role="alert"`; scope alert lookups to the page,
  e.g. `page.getByRole('main').getByRole('alert')`.
- On pages with several password fields use `getByLabel('Password', { exact: true })`.
- The dashboard shows the role as a label ("Student"); the raw value is in `[data-role]`.
