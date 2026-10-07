# Quality audit: Lighthouse, PWA, CSP (web app)

Spec targets: installable PWA, first display < 2 s on 4G, WCAG 2.1 AA.

Reports (median of 3 runs each): [login](lighthouse-login.html), [dashboard](lighthouse-dashboard.html),
[timetable](lighthouse-timetable.html), [announcements](lighthouse-announcements.html).

## Setup

- Production build (`next build`, then `next start -p 3292`), backend on its own MongoDB, demo data
  (`npm run seed:demo`). Signed-in pages are audited as the student Omar Ferchichi (group 4TWIN1), in English.
- Lighthouse 13.5.0, Chromium 153 headless, default mobile settings: 412×823 screen, simulated slow 4G
  (150 ms RTT, 1.6 Mbps down) and a 4× slower CPU. Categories: Performance, Accessibility, Best Practices, SEO.
- The session cookies are put in the browser's cookie jar before the audit (Lighthouse Node API + puppeteer-core).
  Passing them with `--extra-headers` distorts the results: the cookie the page sets (`cl_owner`) then replaces the
  injected header on later requests, so every link prefetch is redirected to `/login` (8–10 extra requests).
- Scores vary by about ±6 points between runs on this machine (timetable: 86, 91, 92), hence the median of 3.

## Scores

"Before": first run with the method above (single run), after the bug fixes of this pass but before the
Lighthouse-driven change. "After": median of 3 runs, final build.

| Page | Performance | Accessibility | Best Practices | SEO | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| `/login` before | 94 | 100 | 100 | 100 | 0.9 s | 3.0 s | 50 ms | 0 |
| `/login` after | **95** | **100** | **100** | **100** | 0.8 s | 2.9 s | 50 ms | 0 |
| `/dashboard` before | 93 | 100 | 100 | 100 | 0.9 s | 3.1 s | 130 ms | 0 |
| `/dashboard` after | **95** | **100** | **100** | **100** | 0.9 s | 2.9 s | 70 ms | 0 |
| `/dashboard/timetable` before | 88 | 100 | 100 | 100 | 0.9 s | 3.3 s | 240 ms | 0 |
| `/dashboard/timetable` after | **91** | **100** | **100** | **100** | 0.9 s | 3.3 s | 100 ms | 0 |
| `/dashboard/announcements` before | 93 | 100 | 100 | 100 | 0.9 s | 3.2 s | 100 ms | 0 |
| `/dashboard/announcements` after | **92** | **100** | **100** | **100** | 0.9 s | 3.1 s | 140 ms | 0 |

- First display: first contentful paint 0.8–0.9 s on simulated slow 4G, well under the 2 s target.
- The differences between "before" and "after" are mostly within the run-to-run noise, except the HTML size
  below.

## What was fixed

- Accessibility: the "Your account" block of `/dashboard` was a `<dl>` whose `<div>` groups also held the icon
  next to `<dt>`/`<dd>` (axe `definition-list` and `dlitem`, serious). The icon now sits inside the `<dt>`;
  both audits pass.
- Page weight: every page shipped the messages of all ten translation namespaces (about 40 KB of JSON) to the
  browser. Each route group now only sends what its Client Components use (`components/i18n/client-messages.tsx`):
  `/login` HTML 73.6 KB → 44.5 KB (gzip 18.4 → 9.7 KB), `/dashboard` 113.9 → 104.1 KB, `/dashboard/announcements`
  85.3 → 75.9 KB.
- Best Practices / security: nonce-based Content-Security-Policy on every page and `Strict-Transport-Security` in
  production (the informative audits "CSP effective against XSS" and "HSTS" pass). Verified on every page of the
  production build (landing, login, signup, forgot/reset password, offline page, 404, all dashboard pages, all
  admin pages, dialogs, menus and the mobile menu open) in English and in French: no CSP violation, no console
  error (apart from the expected 404 of a missing page), service worker active and controlling, offline reloads
  served from the saved pages.
- Offline console noise: links no longer prefetch while offline (`components/ui/app-link.tsx`): 0
  `net::ERR_INTERNET_DISCONNECTED` errors after going offline, reloading saved pages and hovering every navigation
  link (before, each prefetch attempted offline failed with that error).

## What remains (not fixed, with the reason)

- LCP 2.9–3.3 s (simulated). The largest element is text rendered by the server, but Lighthouse's simulation
  charges the JavaScript requested before it: React DOM and the Next.js runtime are about 110 KB gzip of the
  180–235 KB of scripts, on 1.6 Mbps with a 4× CPU. Going lower needs structural work (e.g. loading the mobile
  menu's dialog code on demand, fewer Client Components on first load). The 2 s first-display target is met by FCP.
- "Unused JavaScript" (~26 KB, inside React DOM) and "Legacy JavaScript" (~13 KB: Next.js's built-in polyfills
  for `Array.prototype.at/flat/flatMap`, `Object.fromEntries/hasOwn`, `String.prototype.trimStart/trimEnd`, part
  of the framework chunk and not configurable).
- Back/forward cache: the pages hold private data and are sent with `Cache-Control: no-store` (as are the `/bff`
  answers). Intended.
- One render-blocking stylesheet (12 KB gzip, ~140 ms): inlining it (`experimental.inlineCss`) would add it to
  every HTML answer and lose caching between pages; not done.
- Informative insights only: font preload chain (network dependency tree), ~45 ms of unattributed forced reflow.

## PWA installability (checked by hand: Lighthouse 12+ has no PWA category)

- Manifest `/manifest.webmanifest`, linked from every page: `id` "/", `name`/`short_name` "CampusLink",
  `start_url` "/dashboard", `scope` "/", `display` "standalone", `theme_color` "#253C6D", `background_color`
  "#FFFFFF". Chrome reports no manifest error.
- Icons: `/icons/icon-192.png` (192×192, any), `/icons/icon-512.png` (512×512, any), `/icons/maskable-512.png`
  (512×512, maskable): all served as `image/png` with their declared size.
- Service worker `/sw.js`: scope "/", activated, controls the pages after the first load. `start_url` opens
  offline (served from the saved page: "Welcome, Omar").
- Chrome's own check (DevTools protocol `Page.getInstallabilityErrors`) on `/dashboard`: no error in a regular
  profile (in an incognito profile the only error is "in-incognito").

## Accessibility (WCAG 2.1 AA)

Lighthouse runs a subset of the axe rules: 100 on the four pages (contrast, names, headings, lists, ARIA, …). It
does not replace a manual review (keyboard paths, screen reader announcements, zoom/reflow), which was not part of
this pass.
