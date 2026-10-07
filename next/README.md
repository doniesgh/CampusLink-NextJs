# CampusLink web (Next.js)

Next.js 16 (App Router) + React 19 + Tailwind CSS v4 + next-intl. Talks to the CampusLink backend (`../backend`).
Installable PWA with an offline mode (service worker + IndexedDB).

## Getting started

```bash
cp .env.example .env.local   # API_URL=http://localhost:4000
npm install
npm run dev                  # http://localhost:3000
```

Checks: `npx tsc --noEmit`, `npm run lint`, `npm run build`.
Parallel builds: `NEXT_DIST_DIR=.next-<name> npm run build` (folders `.next-*` are git-ignored; Next adds
`.next-<name>/types/**` to `tsconfig.json` during such a build, do not commit that change).

## Environment

| Variable                   | Default                 | Purpose                                                                              |
| -------------------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| `API_URL`                  | `http://localhost:4000` | Backend base URL (server-only).                                                      |
| `COOKIE_SECURE`            | production only         | `true`/`false` overrides the `Secure` flag of the cookies (server-only).             |
| `NEXT_DIST_DIR`            | `.next`                 | Build/output folder, for side-by-side builds (tests, parallel work).                 |
| `NEXT_PUBLIC_APP_TIMEZONE` | `Africa/Tunis`          | Campus timezone of every displayed date/time (inlined at build time).               |
| `NEXT_PUBLIC_ENABLE_SW`    | unset                   | `true` registers the service worker with `next dev` too (production always does).    |
| `TRUSTED_PROXY_HOPS`       | `0`                     | Reverse proxies in front of Next.js that write the client address (server-only).     |

**Client IP.** Next.js keeps an `X-Forwarded-For` sent by the browser, and the backend trusts Next.js
(`TRUST_PROXY=loopback`) for the audit-log IP and the per-IP + email rate limits. So the web app never forwards the
browser's header: with `TRUSTED_PROXY_HOPS=0` (Next.js reached directly) it sends none (the backend sees the
Next.js host, rate limiting stays per email); with `N > 0` it forwards only the address written by the outermost of
our N proxies (the N-th entry from the end). Production must run behind a reverse proxy that **overwrites** the
header, e.g. nginx `proxy_set_header X-Forwarded-For $remote_addr;` with `TRUSTED_PROXY_HOPS=1`.

## How authentication works

The browser never calls the backend directly: Server Actions (`app/actions/auth.ts`), the proxy (`proxy.ts`),
Server Components and the `/bff` relay call it through `lib/api.ts`, and the tokens live in httpOnly cookies
(`lib/session.ts`):

- `cl_access`: access token (JWT). Kept for the token's lifetime with "Keep me signed in", otherwise a session cookie.
- `cl_refresh`: refresh token, 30 days with "Keep me signed in", otherwise a browser-session cookie.
- `cl_remember`: remembers that choice for later refreshes.
- `cl_owner`: the user id, readable by JavaScript (no secret), same lifetime as `cl_refresh`. The service worker
  only serves an offline copy of a page to that account, so copies die with the session cookies.
- `cl_ended`: set for 2 minutes whenever the session cookies are cleared (logout, revoked/expired session, password
  changed or reset): the next `/login` or `/signup` answer carries `Clear-Site-Data: "cache", "storage"`.

`proxy.ts` (Next 16's renamed middleware) protects `/dashboard`, sends signed-in users away from `/login` and
`/signup`, refreshes an expired access token before the page renders, and passes the current path to Server
Components (`x-cl-path`). The browser's `User-Agent` is forwarded to the backend (client IP: see above).
`/auth/expired` clears the cookies (only for same-origin navigations) when the backend rejects a token.

Nothing personal outlives a session on a shared computer:

- Logout (`components/shell/logout-button.tsx`) first clears IndexedDB, Cache Storage and this device's push
  subscription, then ends the session.
- A session that ends any other way: `/auth/expired` answers with `Clear-Site-Data: "cache", "storage"` (Cache
  Storage, IndexedDB, service worker and its push subscription, HTTP cache; cookies stay), and so does the next
  login/signup page after the cookies were cleared (`cl_ended`, see `proxy.ts`; when a Server Action redirects
  there, Next.js copies the header onto the action's answer). Browsers ignore it outside secure contexts, so the
  auth pages also clean up from JavaScript when the request had no session cookie
  (`components/offline/stale-session-cleanup.tsx`).
- When another account opens the dashboard, `adoptOwner()` drops the previous account's data, saved pages and
  push subscription.

## Languages (next-intl, no locale routing)

- Locale = cookie `NEXT_LOCALE` → `Accept-Language` (first of fr/en) → `fr` (`i18n/request.ts`). URLs never change.
- Messages: `messages/<locale>/<namespace>.json`, namespaces `common, landing, auth, dashboard, account, admin,
  notifications, offline, timetable, announcements`. Keys are type-checked against the English files
  (`global.d.ts`): every key must exist in **both** `en` and `fr`. French uses "tu", warm and simple.
- English texts are part of the UI contract (the Playwright suite runs in English): never reword them.
- Switcher: `<LanguageSwitcher />` (select labelled "Language"/"Langue"); it sets the cookie and, when signed in,
  `PATCH /api/users/me { locale }`. Signup sends the current locale; login keeps the language the user is looking
  at (cookie, else browser language, else the account's) and saves it to `user.locale` when it differs.
- Server: `const t = await getTranslations("admin.users")`; Client: `const t = useTranslations("timetable")`.
- Dates: `format.dateTime(date, "time" | "date" | "dayMonth" | "weekdayDayMonth" | "weekdayLong" | "dateTime" |
  "dayMonthTime")` (presets in `i18n/config.ts`); the formatter already uses the campus timezone (24h times).
- Backend error codes: `useErrorFormatter()` (`lib/i18n/client.ts`) / `getErrorFormatter()` (`lib/i18n/server.ts`)
  → `.message(error)`, `.fieldErrors(error)`, `.forCode(code)`; texts in `common.errors.<CODE>`.

## BFF: `/bff/[...path]`

`app/bff/[...path]/route.ts` + `lib/bff.ts` relay `/bff/<path>?<query>` to `API_URL/api/<path>?<query>`:

- adds `Authorization: Bearer <cl_access>`; refreshes the pair when the token is missing/expiring and once more on
  `401 TOKEN_EXPIRED` (new cookies set on the response). An unrecoverable 401 is returned as-is.
- `/bff/auth/*` → 404. Non-GET requests need a same-origin `Origin` header (else 403 `FORBIDDEN`).
- JSON, multipart uploads and binary/ICS downloads pass through (`Content-Type`, `Content-Disposition`);
  responses are `Cache-Control: private, no-store`. Backend unreachable → 502 `NETWORK_ERROR`.
- File links can point straight at it: `<a href="/bff/announcements/<id>/attachments/<aid>">`.

## Data layer (offline-first, Client Components)

Import from `@/lib/offline` (IndexedDB database `campuslink`: stores `cache`, `outbox`, `meta`; records are
scoped to the signed-in user by `<DataLayerProvider>` in the dashboard layout).

```tsx
"use client";
import { queueMutation, useOfflineQuery, useQueryClient, useOnlineStatus } from "@/lib/offline";

// Reads: stale-while-revalidate. Saved data first (with savedAt), then /bff/<path> when online,
// again on reconnect, on tab focus and every `refreshInterval` ms. Path relative to /api.
const { data, savedAt, isLoading, error, refresh, mutate } = useOfflineQuery<MyType>(
  ["timetable", "week", date],              // key: string or array ("timetable:week:2026-10-05")
  `/timetable/me?from=${from}&to=${to}`,    // null disables the query
  { refreshInterval: 0, fallbackData: undefined }
);

// Writes (idempotent only in phase 1): sent now when online; queued in IndexedDB when offline or when the
// server can't be reached, then replayed on reconnection and by Background Sync. Last write wins per method+path.
const result = await queueMutation({ method: "POST", path: `/announcements/${id}/read` });
// result.status: "sent" (result.data) | "queued" | "failed" (result.error: BffError, a real API error)

// Optimistic updates of other queries: useQueryClient().setQueryData(key, updater); .invalidate("timetable")
```

- **Render the first data on the server** and hand it to the hook, so a page makes no API request from the browser
  when it loads (faster, and no race with tests that clear cookies right after the dashboard appears):

  ```tsx
  // page.tsx (Server Component)
  const initial = await serverSnapshot<MyType | null>(`/timetable/me?from=${from}&to=${to}`, null); // lib/server-api.ts
  return <MyView initial={initial} />;
  // my-view.tsx ("use client")
  useOfflineQuery<MyType>(key, path, {
    fallbackData: initial.data ?? undefined,
    fallbackSavedAt: initial.savedAt, // an offline copy of an old page never overwrites newer saved data
    revalidateOnMount: !initial.data,
  });
  ```

  Dashboard widgets (`TodayWidget`, `LatestWidget`) should follow this pattern too.
- `bffFetch(path, { method, body })` (`@/lib/offline`) for one-off online calls (throws `BffError` with `status`,
  `code`, `details`; on 401 it sends the user to `/auth/expired`).
- Token refresh is single-flight (`lib/refresh.ts`): concurrent requests that find the access token expired share
  one `/api/auth/refresh` call (the backend rotates refresh tokens), and the new pair is reused for 30 s.
- `useOnlineStatus()`, `usePendingCount()`: connectivity and outbox size (the banner already shows both).
- Pages using `useOfflineQuery` automatically feed the banner's "Last updated <time>".
- **Mutations that can fail with an expected 4xx** (forms, conflicts, validation) should use **Server Actions**
  with `serverApi()` (`lib/server-api.ts`), not the BFF: Chromium logs every non-2xx `fetch` as a console error,
  which fails the Playwright browser guard. See `app/(back)/dashboard/admin/users/actions.ts`:
  `serverApi(path, { method, body })` (FormData = multipart), `actionSuccess(message)`, `actionFailure(error)`
  (localised; 401 → `/auth/expired`), then `refresh()` from `next/cache` to re-render the page.

## Offline mode / PWA (Module 8)

- `app/manifest.ts` (`/manifest.webmanifest`): name "CampusLink", start_url `/dashboard`, standalone,
  theme `#253C6D`, icons 192/512 + maskable in `public/icons/` (`node scripts/generate-icons.mjs` regenerates them).
- `public/sw.js`, scope `/`, registered in production builds (or `NEXT_PUBLIC_ENABLE_SW=true`) by
  `components/pwa/service-worker-registrar.tsx`; in dev without the flag any old worker is unregistered.
  - precache `/offline` (+ its static files) and the icons; cache-first for `/_next/static/*`, fonts, icons;
  - network-first for navigations (6 s timeout when a copy exists) → cached page → `/offline`; pages reached by
    client-side navigation are saved in the background (`CACHE_PAGE` message, at most every 10 min per URL; these
    requests carry `x-cl-background: 1` and the proxy never refreshes tokens for them);
  - saved pages (Cache Storage `campuslink-pages-v2`): only `/` (public) and the offline module pages
    `/dashboard`, `/dashboard/timetable`, `/dashboard/announcements(/<id>)`, `/dashboard/notifications`, never
    the admin pages or `/dashboard/account`. Each copy carries its owner (`x-cl-owner`, set by `proxy.ts` from the
    token) and is served only to that account: the `cl_owner` cookie (Cookie Store API), or the IndexedDB owner
    where that API is missing. Copies older than 24 h or belonging to another account are deleted;
  - never caches `/bff/*`, `/api/*`, `/auth/*`, the auth pages, Server Actions or non-GET requests;
  - `push` → notification (`title, body, icon, badge, tag, data.link`), `notificationclick` → focus/open the link,
    `sync` (`campuslink-outbox`) → replays the outbox.
- `/offline`: public fallback page with links to the saved timetable/announcements views.
- Connectivity banner (`role="status"`, outside `<main>`): "You're offline. Showing saved data." + "Last updated
  <time>" + "<n> changes waiting to sync".
- We do not enable `experimental.useOffline`: it would keep failed navigations pending, whereas the service
  worker answers them with the saved page (full offline reloads need the worker anyway).
- Try it: `npm run build && npm start`, open the app once, then DevTools > Network > Offline and reload.

## App shell and pages

`app/(back)/dashboard/layout.tsx` → `components/shell/app-shell.tsx`: sidebar (≥ lg) / top bar + bottom
navigation (phones), `nav` "Main navigation" (Home, Timetable, Announcements, Notifications + unread badge, Account),
"Administration" group for ADMIN (Users, Academic structure, Timetable management, Announcements management,
Audit log), "Teaching" group with "Announcements management" for TEACHER. Pages: `/dashboard`,
`/dashboard/notifications`, `/dashboard/account`, `/dashboard/admin/{users,academic,audit}`, plus the module pages.

Role guard: `const { user, error } = await requireRole(["ADMIN"])` (`lib/dal.ts`) redirects other roles to
`/dashboard` (announcements management: `["ADMIN", "TEACHER"]`). `getCurrentUser()` loads the user once per request.

## Conventions for module work (timetable, announcements)

- Ownership (docs/phase1-contract.md §12): module folders only; ask for changes elsewhere.
- Messages: `messages/{en,fr}/timetable.json` / `announcements.json` (same keys in both files).
- Dashboard widgets: keep `export function TodayWidget({ user }: { user: User })` in
  `components/timetable/today-widget.tsx` and `LatestWidget` in `components/announcements/latest-widget.tsx`.
- UI primitives (`components/ui/`, token-based, dark-mode ready, accessible):
  `Button` (`asChild`), `Badge` (pill: default/secondary/neutral/highlight/success/warning/danger/outline),
  `Card*`, `Dialog*`, `ConfirmDialog` (alert-dialog.tsx), `DropdownMenu*`, `Popover*`, `Tooltip`, `Tabs*`,
  `Table*`, `Select` (native `<select>`, also `multiple`), `Checkbox`/`CheckboxField` (native), `RadioGroup`
  (native radios in a fieldset), `Switch`, `Input`, `Textarea`, `Label`, `Field` (label + hint + error wiring),
  `InlineFeedback` + `useFeedback()` + `fromActionState()`, `EmptyState`, `Skeleton`/`SkeletonList`,
  `PageHeader` (the page's h1), `Pagination` (server), `Sheet`. Icons: `lucide-react` (line icons).
- Time: `lib/datetime.ts` (`dateKey`, `timeKey`, `todayKey`, `zonedTimeToUtc("2026-10-08", "08:30")`,
  `addDays`, `startOfWeek` (Monday), `startOfMonth`, `formatTimeRange` → "08:30–10:00"), all in the campus timezone.
- Feedback: at most one `role="status"` and one `role="alert"` inside `<main>` at a time (tests look them up there).
  Dialogs are portals (outside `<main>`): report the outcome of a dialog action in the page.

## Notes for E2E tests

- Next.js adds a hidden route announcer with `role="alert"`; scope alert lookups to the page,
  e.g. `page.getByRole('main').getByRole('alert')`. The connectivity banner (`role="status"`) is outside `<main>`.
- On pages with several password fields use `getByLabel('Password', { exact: true })`
  (account page: `getByLabel('New password', { exact: true })`).
- The dashboard shows the role as a label ("Student"); the raw value is in `[data-role]`.
- Selects are native: `getByLabel('Language').selectOption('fr')`. The shell hides its own language select on
  `/dashboard/account`, so the page's "Language" select is the only one there.
- French UI in a test: set the `NEXT_LOCALE=fr` cookie or use a `fr-FR` browser locale (login keeps the browser's
  language, so accounts created by the API with the default `locale: "fr"` still see English in Chromium en-US).
- Offline tests (`E2E_NEXT_MODE=start`): a saved page is only served while the `cl_owner` cookie exists, so a test
  that injects `cl_access`/`cl_refresh` itself must open a dashboard page online first (the proxy then sets
  `cl_owner`). Going offline makes Next.js link prefetches fail (`net::ERR_INTERNET_DISCONNECTED` console errors):
  filter those in the test (see `tests/e2e/offline-privacy.spec.ts`). After a session ends, `Clear-Site-Data` also
  unregisters the service worker; the next route change registers it again.
