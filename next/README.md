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
| `APP_ORIGIN`               | unset                   | Public origin(s) of the web app, comma-separated (`https://campuslink.example`): the BFF's same-origin check compares `Origin` with it instead of the `Host` header. |
| `COOKIE_SECURE`            | production only         | `true`/`false` overrides the `Secure` flag of the cookies (server-only).             |
| `MAX_UPLOAD_MB`            | `10`                    | Same value as the backend: request bodies of the BFF and of Server Actions are capped at 5 × it + 1 MB (read when the server starts). |
| `NEXT_DIST_DIR`            | `.next`                 | Build/output folder, for side-by-side builds (tests, parallel work).                 |
| `NEXT_PUBLIC_APP_TIMEZONE` | `Africa/Tunis`          | Campus timezone of every displayed date/time (inlined at build time).               |
| `NEXT_PUBLIC_ENABLE_SW`    | unset                   | `true` registers the service worker with `next dev` too (production always does).    |
| `TRUSTED_PROXY_HOPS`       | `0`                     | Reverse proxies in front of Next.js that write the client address (server-only).     |

**Client IP.** Next.js keeps an `X-Forwarded-For` sent by the browser, and the backend trusts Next.js
(`TRUST_PROXY=loopback`) for the audit-log IP and the rate limits. So the web app never forwards the browser's
header: with `TRUSTED_PROXY_HOPS=0` (Next.js reached directly) it sends none: the backend sees the Next.js host
(loopback), so only the per route + email limits apply to web users (the backend does not apply its per-IP limits
to loopback callers without `X-Forwarded-For`, which would otherwise be shared by every web user). With `N > 0` it
forwards only the address written by the outermost of our N proxies (the N-th entry from the end), and the per-IP
limits apply too. Production should run behind a reverse proxy that **overwrites** the header, e.g. nginx
`proxy_set_header X-Forwarded-For $remote_addr;` with `TRUSTED_PROXY_HOPS=1`.

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

The backend ties each push subscription to the login session that registered it and drops all of a user's
subscriptions when every session is revoked (change password). `resyncPushSubscription()` (`lib/offline/push.ts`)
registers the browser's existing subscription again for the current session (`POST /bff/push/subscriptions`,
idempotent upsert; never asks for permission, never throws): after "Change password" succeeds without two-step
verification, and once per tab session per user when the dashboard mounts online (after `adoptOwner()`,
`sessionStorage` key `cl-push-resync:<userId>`).

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
- Client Components only receive the namespaces of their route group (`components/i18n/client-messages.tsx`), so
  a page does not ship all ten namespaces: root layout `common` + `offline`; `(front)` + `landing`; `(auth)` +
  `auth`; `/dashboard` + `dashboard, account, notifications, timetable, announcements` (`DASHBOARD_NAMESPACES`);
  `/dashboard/account` + `auth` (password field); `/dashboard/admin/*` + `admin`. A nested provider replaces the
  messages of its parent: when a Client Component (or a shared component rendered inside one) starts using
  another namespace on a page, add it to that group's `<ClientMessages namespaces>` or the browser logs
  `MISSING_MESSAGE`. Server Components are not concerned (they read every namespace).
- Dates: `format.dateTime(date, "time" | "date" | "dayMonth" | "weekdayDayMonth" | "weekdayLong" | "dateTime" |
  "dayMonthTime")` (presets in `i18n/config.ts`); the formatter already uses the campus timezone (24h times).
- Backend error codes: `useErrorFormatter()` (`lib/i18n/client.ts`) / `getErrorFormatter()` (`lib/i18n/server.ts`)
  → `.message(error)`, `.fieldErrors(error)`, `.forCode(code)`; texts in `common.errors.<CODE>`.

## BFF: `/bff/[...path]`

`app/bff/[...path]/route.ts` + `lib/bff.ts` relay `/bff/<path>?<query>` to `API_URL/api/<path>?<query>`:

- adds `Authorization: Bearer <cl_access>`; refreshes the pair when the token is missing/expiring and once more on
  `401 TOKEN_EXPIRED` (new cookies set on the response). An unrecoverable 401 is returned as-is.
- `/bff/auth/*` → 404. Non-GET requests are checked in this order, before any byte of the body is read:
  1. same-origin `Origin` header, else 403 `FORBIDDEN`. The origin is compared with `APP_ORIGIN` when set,
     otherwise its host with the `Host` header; `X-Forwarded-Host` is only used behind trusted proxies
     (`TRUSTED_PROXY_HOPS > 0`, the entry written by the outermost one), since anyone can send it;
  2. a session cookie (`cl_access` or `cl_refresh`), else 401 `AUTH_REQUIRED`;
  3. a body of at most 5 × `MAX_UPLOAD_MB` + 1 MB (51 MB by default), else 413 `PAYLOAD_TOO_LARGE`:
     `Content-Length` is checked first, and the limit is enforced while the body is read (chunked uploads).
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
- The fallback options belong to the key they were first passed with. When the key changes (filters, paging)
  while the same `fallbackData` object is still passed, the new key gets no fallback (it shows its own saved
  data or a skeleton, never the previous key's data) and revalidates on mount. A new `fallbackData` object passed
  together with the new key seeds that key instead.
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
- Links: import `Link` from `@/components/ui/app-link` (same props as `next/link`), not from `next/link`. It turns
  prefetching off while offline (`prefetch={false}`), so the shell, the widgets and the lists do not flood the
  console with `net::ERR_INTERNET_DISCONNECTED`; prefetching resumes when the connection is back.
- Try it: `npm run build && npm start`, open the app once, then DevTools > Network > Offline and reload.

## App shell and pages

`app/(back)/dashboard/layout.tsx` → `components/shell/app-shell.tsx`: sidebar (≥ lg) / top bar + bottom
navigation (phones), `nav` "Main navigation" (Home, Timetable, Announcements, Notifications + unread badge, Account),
"Administration" group for ADMIN (Users, Academic structure, Timetable management, Announcements management,
Audit log), "Teaching" group with "Announcements management" for TEACHER. Pages: `/dashboard`,
`/dashboard/notifications`, `/dashboard/account`, `/dashboard/admin/{users,academic,audit}`, plus the module pages.

Role guard: `const { user, error } = await requireRole(["ADMIN"])` (`lib/dal.ts`) redirects other roles to
`/dashboard` (announcements management: `["ADMIN", "TEACHER"]`). `getCurrentUser()` loads the user once per request.

- `/dashboard`: "Your account" is a `<dl>` of `<div><dt/><dd/></div>` groups (the icon sits inside the `<dt>`);
  the role's raw value is on its `<dd data-role>`.
- `/dashboard/admin/audit`: the "Action" column shows a readable label (`admin.audit.actionLabels.<code>`, FR/EN,
  e.g. "User created" / "Utilisateur créé") with the raw code under it; unknown codes are shown as they are. The
  "Action" filter offers the same labels (option values stay the codes, `?action=user.create`). "Target" keeps the
  entry's `summary` (else `targetType targetId`).

## Timetable (Module 1)

Files: `app/(back)/dashboard/timetable/`, `app/(back)/dashboard/admin/timetable/`, `components/timetable/`,
`lib/timetable/`, `messages/{en,fr}/timetable.json`.

- `/dashboard/timetable` (`page.tsx` + `components/timetable/timetable-view.tsx`): STUDENT → the classes of their
  group, TEACHER → the classes they teach, ADMIN/ALUMNI → a card linking to the management page.
  - URL state `?view=day|week|month&date=YYYY-MM-DD&subject=<id>&teacher=<id>` (`lib/timetable/range.ts`). Default
    view: "day" on phones (user-agent guess, corrected by the `(max-width: 639px)` media query), "week" otherwise.
    Periods and views push a history entry, filters replace it (`setSearch`, no server round trip).
  - The first period is rendered on the server (`serverSnapshot`); other periods come from `useOfflineQuery`
    (`/timetable/me?from&to`, one key per period).
  - Controls: group "View" ("Day" / "Week" / "Month", `aria-pressed`), group "Change period" ("Previous" /
    "Today" / "Next"), the period as an `h2` (`aria-live="polite"`), selects "Subject" and "Teacher" (options from
    the loaded period). Month grid: one `button[data-day="YYYY-MM-DD"]` per day (arrow keys move between days).
  - Each class is an `article[data-session-id][data-status="SCHEDULED|CANCELLED"]` (`session-card.tsx`): subject,
    "08:30–10:00", room ("Room to be confirmed"), teacher, "Cancelled", "Moved from <room>", "Rescheduled, was
    <time>". Empty period: "No classes in this period."; student without a group: "You're not assigned to a group
    yet." (`hint: "NO_GROUP"`).
  - "Export" menu (`export-menu.tsx`): "Copy calendar link" (`GET /bff/timetable/me/calendar-link`, then the link
    with "Reset link" + confirmation), "Download .ics" (`/bff/timetable/me/calendar.ics`), "Add to Google Calendar".
- Dashboard widget `TodayWidget` (`today-widget.tsx`, data rendered on the server, view in `today-widget-view.tsx`):
  "Today's classes" or "Next class: …", items `[data-session-id][data-status]`, link "See my timetable".
- `/dashboard/admin/timetable` (ADMIN, `timetable-manager.tsx`): tabs "Group" / "Teacher" / "Room" + select "Show
  timetable for", week grid, "Add session" dialog (`session-dialog.tsx`, Server Actions in `actions.ts`; conflicts
  → `role="alert"` with "Conflict"; series: "This session only" / "This and following sessions"), "Import CSV"
  dialog (`import-dialog.tsx`: "CSV file", "Check file" = dry run, then "Import" and the report).
- Offline: the page is saved by the service worker and every period opened online stays readable from IndexedDB.
  A saved copy shown offline (or after a failed refresh) says "Saved copy from <time>."; a period never opened
  says "This period isn't saved on this device yet.". The export actions that need the server are disabled
  offline (an already loaded calendar link can still be copied).

## Announcements (Module 7)

Files: `app/(back)/dashboard/announcements/`, `app/(back)/dashboard/admin/announcements/`,
`components/announcements/`, `lib/announcements/`, `messages/{en,fr}/announcements.json`.

- `/dashboard/announcements` (`feed-view.tsx`): h1 "Announcements", checkbox "Unread only" (remounts the list in
  that mode), pages of 20 with "Load more", unread summary ("3 unread announcements"). Each item is an
  `article[data-announcement-id][data-unread="true|false"]` (`announcement-card.tsx`) whose title links to the detail
  page (the whole card is clickable), with the priority badge `[data-priority]` ("Urgent", "High", "Normal",
  "Low"), "New" when unread, author, date and files count.
- `/dashboard/announcements/[id]` (`announcement-view.tsx`): h1 = title, body `[data-testid="announcement-body"]`
  (plain text, line breaks kept, never HTML), attachments as download links `/bff/announcements/<id>/attachments/<aid>`
  (the filename). Opening it marks it as read (`POST /announcements/:id/read` through `queueMutation`, queued
  offline). Unknown or not visible → "not found" state. Authors and admins also see the reads and "View stats".
- Dashboard widget `LatestWidget` (`latest-widget.tsx` + `latest-card.tsx`): the 4 latest, "<n> new", "See all
  announcements"; managers also get "Write an announcement".
- `/dashboard/admin/announcements` (ADMIN, TEACHER, `management-view.tsx`): "New announcement", rows
  `tr[data-announcement-id]` with "Title", "Status" (`[data-status]` badge), "Recipients", "Read rate", "Actions"
  (`manage-actions.tsx`: "Edit", "Publish now" and "Delete", the last two with a confirmation);
  `?done=draft|published|scheduled|updated` shows
  the outcome of the last action.
- `/new` and `/[id]/edit` (`announcement-form.tsx`, Server Action `saveAnnouncementAction`): "Title", "Message",
  "Priority", fieldset "Audience" ("Roles", "Programs", "Levels", "Groups") with the live count
  `[data-testid="audience-recipients"]` ("<n> recipients"), file input "Attachments" (5 files of 10 MB, checked in
  the browser first; sent through the Server Action, see "Security"), checkbox "Publish later" + "Publish at",
  buttons "Save draft", "Publish now", "Schedule" ("Save changes" once published). `/[id]`: stats with "Read rate"
  and the reads per day (`reads-chart.tsx`).
- Offline (`lib/announcements/offline.ts`, `read-state.ts`, `components/announcements/offline-reader.tsx`):
  - feed pages, details and the widget list are `useOfflineQuery` entries (`announcements:feed:<mode>:<page>`,
    `announcements:detail:<id>`, `announcements:latest`); "Unread only" never loaded on this device filters the
    saved full list instead;
  - while the feed is shown online, the service worker saves the detail pages of the 10 newest announcements (and
    the static files their route needs);
  - offline, a click opens the saved page with a full page load (answered by the service worker) or, when that
    page was never saved, the saved announcement in a dialog ("You're offline: this is the copy saved on this
    device."), and marks it as read (queued: "1 change waiting to sync");
  - reads made on this device update the saved lists at once (`useLocalReads`), so "New" badges and counts stay
    right offline; a push about an announcement refreshes the lists while the app is open.

## Security

- Headers (`next.config.ts`): `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Content-Type-Options: nosniff`, `Permissions-Policy` (camera, microphone, geolocation off) on every answer;
  in production builds also `Strict-Transport-Security: max-age=63072000; includeSubDomains` (browsers ignore it on
  plain-http answers such as local test runs). `/sw.js` has its own policy (`default-src 'self'; script-src 'self'`).
- Content-Security-Policy of the pages (`lib/csp.ts`), set by `proxy.ts` with a new nonce for every request. The
  policy is also put on the forwarded request: Next.js reads the nonce there and adds it to its scripts, its
  stylesheet links and its inline styles. Production policy:

  ```
  default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; style-src 'self' 'unsafe-inline';
  style-src-elem 'self' 'nonce-…'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self';
  connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self';
  form-action 'self'; frame-ancestors 'none'
  ```

  - Scripts: only those carrying the nonce, and what they load (`'strict-dynamic'`). No inline `<script>` or
    `eval` anywhere; if one is ever needed, forward the nonce from `proxy.ts` (e.g. an `x-nonce` request header)
    and put it on the tag.
  - Styles: `<style>`/`<link>` elements need the nonce or this origin. Radix dialogs, sheets and menus add a
    `<style>` element while open (react-remove-scroll): `components/security/style-nonce.tsx` (root layout) hands
    the page nonce to `get-nonce`. `style="…"` attributes stay allowed (React renders some on the server: subject
    colours, progress bars, charts). `style-src` is the fallback of browsers without `style-src-elem/-attr`.
  - `next dev` adds `'unsafe-eval'` (React debugging), allows inline styles (Turbopack injects `<style>` tags) and
    local WebSockets (`ws://localhost:*`, `ws://127.0.0.1:*`: dev tools beside the dev server, e.g. React DevTools
    or the Console Ninja editor extension, which injects a log forwarder into `next dev` pages).
  - Nonces need dynamic rendering: every page is (the root layout reads the locale cookie). A statically
    prerendered page (`○` in the build output) would have no nonce and its scripts would be blocked.
  - The matcher of `proxy.ts` covers every page (all paths except `/_next/static`, `/_next/image`, `/bff/`,
    `/api/`, `/icons/`, `/sw.js`, `/manifest.webmanifest`, `/favicon.ico`, `/logo.png` and link prefetches); only
    `/dashboard/*`, `/login` and `/signup` run the session logic.
  - Pages saved by the service worker keep the policy and the nonce they were rendered with (both are stored), so
    they still start offline.
- Request bodies: the BFF refuses non-GET requests without a session cookie (401) and bodies over 5 ×
  `MAX_UPLOAD_MB` + 1 MB (413) before reading them (see "BFF"). Server Actions: `serverActions.bodySizeLimit` and
  `proxyClientMaxBodySize` use the same limit (`"51mb"` by default), the smallest that fits the largest real
  action: the announcement composer uploads its 5 attachments of 10 MB through `saveAnnouncementAction`. Server
  Action POSTs of `/dashboard` pages go through `proxy.ts` (token refresh), which only buffers
  `proxyClientMaxBodySize` bytes (10 MB by default: larger uploads reached the action truncated, "Unexpected end of
  form").

## Quality (Lighthouse)

Reports and scores: `docs/quality/` (mobile, simulated slow 4G, `next start`). Accessibility, Best Practices and
SEO are at 100 on `/login`, `/dashboard`, `/dashboard/timetable` and `/dashboard/announcements`; first contentful
paint is about 0.9 s. Authenticated pages must be audited with the session in the browser's cookie jar (not
`--extra-headers`), otherwise the link prefetches are redirected to `/login` and distort the results.

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
  `cl_owner`). App links (`@/components/ui/app-link`) do not prefetch while offline, but a prefetch already in
  flight when the network drops can still fail with `net::ERR_INTERNET_DISCONNECTED`: keep filtering that message
  in offline tests (see `tests/e2e/offline-privacy.spec.ts`). After a session ends, `Clear-Site-Data` also
  unregisters the service worker; the next route change registers it again.
- A CSP violation is logged as a console error ("Refused to …" / "violates the following Content Security Policy
  directive"), so the browser guard of the suite also catches them.
