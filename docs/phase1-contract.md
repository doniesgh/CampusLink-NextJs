# CampusLink — Phase 1 contract

Scope: **Module 1 (smart timetable)**, **Module 7 (notifications & announcements)**, **Module 8 (offline mode / PWA)**,
plus the foundations they need (academic structure, in-app + push notifications, audit log, i18n FR/EN,
admin screens) and the hardening items left from the first review.

This document is the source of truth for the backend (`backend/`), the web app (`next/`) and the Playwright
suite (`tests/`). The existing API (auth, users) keeps working unchanged unless stated here.
A Flutter app will consume the same API later: everything must stay client-agnostic (tokens in JSON bodies,
stable error codes, no cookie dependence in the backend).

---

## 0. Conventions (same as the existing API)

- JSON in/out. Every error: `{ "error": "<English message>", "code": "<STABLE_CODE>", "details"?: object }`.
- Auth: `Authorization: Bearer <accessToken>`; existing codes `AUTH_REQUIRED`, `TOKEN_EXPIRED`, `INVALID_TOKEN`, `FORBIDDEN`.
- Every resource is serialized with a string `id` (no `_id`, no `__v`, no secret fields).
- Dates are ISO 8601 UTC strings in JSON.
- **Campus timezone**: `APP_TIMEZONE` (backend) / `NEXT_PUBLIC_APP_TIMEZONE` (web), default `Africa/Tunis`.
  Default ranges ("this week", "today"), CSV import times, "same day" checks and every displayed time use it.
  Weeks start on Monday.
- Paginated lists: `?page=1&limit=20` (limit max 100) → `{ items, total, page, limit }`.
- New generic codes: `RESOURCE_NOT_FOUND` (404, any phase-1 resource), `ALREADY_EXISTS` (409, `details.field`),
  `IN_USE` (409, resource still referenced; `details.references`), `INVALID_STATE` (409),
  `TOO_MANY_REQUESTS` (429), `RANGE_TOO_LARGE` (400).
- Mongoose model names are part of the contract because modules reference each other loosely through
  `mongoose.models.<Name>` (check that the model is registered before using it):
  `User`, `RefreshToken`, `Program`, `Group`, `Subject`, `Room`, `Notification`, `PushSubscription`, `AuditLog`,
  `ClassSession`, `Announcement`, `AnnouncementRead`.

## 1. User changes

- New fields: `locale` (`'fr' | 'en'`, default `'fr'`), `group` (ObjectId → Group, students only, default null),
  `calendarToken` (secret, `select: false`, created by the timetable module).
- User JSON adds `locale` and `group`:
  `group: { id, name, level, academicYear, program: { id, name, code } } | null`.
- `POST /api/auth/signup` accepts an optional `locale` (`fr`|`en`, invalid → 400 `VALIDATION_ERROR`).
- `PATCH /api/users/me` also accepts `locale`.
- Admin `POST /api/users` and `PATCH /api/users/:id` accept `group` (group id or `null`). Only for role STUDENT:
  setting a group on another role → 400 `VALIDATION_ERROR` (`details.group`); changing a student's role to
  another role clears the group. Unknown group → 400 `VALIDATION_ERROR`.
- `GET /api/users` new filters: `group`, `program`, `level`, `q` (case-insensitive contains on first name,
  last name or email; regex-escaped). Existing `role` and `email` filters stay.

## 2. Academic structure — `/api/academic` (Module 10 support)

| Resource | JSON |
|---|---|
| Program | `{ id, name, code, description }` — `code` unique, stored uppercase |
| Group | `{ id, name, level, academicYear, program: { id, name, code }, studentCount }` — `level` integer 1..5, `academicYear` `"YYYY-YYYY"`, `name` unique per academicYear |
| Subject | `{ id, name, code, color }` — `code` unique uppercase, `color` `#RRGGBB` (default assigned) |
| Room | `{ id, name, building, capacity, type }` — `name` unique, `type` ∈ `CLASSROOM`, `AMPHITHEATER`, `LAB`, `OTHER` |

For each of `programs`, `groups`, `subjects`, `rooms`:
- `GET /api/academic/<plural>` — any authenticated user, full list sorted by name (groups support `?program=&level=&academicYear=`).
- `POST /api/academic/<plural>` — ADMIN → 201.
- `PATCH /api/academic/<plural>/:id` — ADMIN → 200.
- `DELETE /api/academic/<plural>/:id` — ADMIN → 204, or 409 `IN_USE` when referenced (program ← groups;
  group ← users, ClassSession.groups, Announcement.audience.groups; subject/room ← ClassSession;
  program ← Announcement.audience.programs).
- Errors: 400 `VALIDATION_ERROR`, 404 `RESOURCE_NOT_FOUND`, 409 `ALREADY_EXISTS`.
- Every mutation is audited (`academic.<resource>.create|update|delete`).

## 3. Notifications — `/api/notifications` (shared by modules 1 and 7)

Notification JSON: `{ id, type, title, body, link, data, readAt, createdAt }`
- `type` ∈ `TIMETABLE_CHANGE`, `ANNOUNCEMENT`, `SYSTEM`.
- `title`/`body` are rendered **in the recipient's locale** when created (French uses "tu").
- `link` is a relative web path (e.g. `/dashboard/announcements/<id>`). Kept 90 days (TTL index).

Endpoints (auth):
- `GET /api/notifications?unread=true&page&limit` → `{ items, total, page, limit, unreadCount }`, newest first.
- `GET /api/notifications/unread-count` → `{ count }`.
- `POST /api/notifications/:id/read` → 200 notification (idempotent; other user's id → 404 `RESOURCE_NOT_FOUND`).
- `POST /api/notifications/read-all` → 200 `{ updated }`.

Internal service (backend): `notificationService.notifyUsers(userIds, buildMessage)` where
`buildMessage(locale) => ({ type, title, body, link, data })`. Creates in-app notifications in batches, then
sends a push to each user's subscriptions in their locale. Never throws because of push failures.

## 4. Push — `/api/push`

- `GET /api/push/vapid-public-key` (no auth) → `{ publicKey }`, or 503 `PUSH_DISABLED` when VAPID is not configured.
- `POST /api/push/subscriptions` (auth) body
  - web: `{ type: "web", endpoint, keys: { p256dh, auth } }`
  - mobile (future Flutter): `{ type: "fcm", token }` — stored; FCM sending is not implemented in phase 1 (logged, skipped).
  → 201 `{ id }`. Upsert by endpoint/token (re-assigned to the current user).
- `DELETE /api/push/subscriptions` (auth) body `{ endpoint }` or `{ token }` → 204 (idempotent).
- Push payload (JSON): `{ title, body, link, tag, data }`. Subscriptions answering 404/410 are deleted.
- `PUSH_OUTBOX_FILE` (tests): when set, every push is appended as one JSON line
  `{ userId, subscriptionId, type, endpoint, payload, sentAt }` and **not** sent to the push service.
- `npm run generate-vapid` prints a new key pair for `backend/.env`.

## 5. Audit log — `/api/audit` (Module 10)

AuditLog JSON: `{ id, actor: { id, firstname, lastname, email, role } | null, action, targetType, targetId, summary, metadata, ip, userAgent, createdAt }`
- `GET /api/audit?action=&actor=&targetType=&from=&to=&page&limit` — ADMIN, newest first.
- `auditService.record(req, { action, targetType, targetId, summary, metadata })` takes the actor from `req.user`,
  the client IP from `req.ip` (with `trust proxy`) and the User-Agent. Never stores secrets.
- Minimum actions: `user.create`, `user.update` (metadata lists changed fields; `role` change explicit),
  `user.delete`, `auth.password_reset`, `auth.password_change`, `academic.*`, `timetable.session.create|update|cancel|delete`,
  `timetable.import`, `announcement.create|publish|schedule|update|delete`.

## 6. Module 1 — Timetable — `/api/timetable`

ClassSession JSON:
```
{ id,
  subject: { id, name, code, color },
  teacher: { id, firstname, lastname },
  groups: [ { id, name, level, program: { id, code } } ],
  room: { id, name, building } | null,
  startsAt, endsAt,
  type: "LECTURE" | "TUTORIAL" | "LAB" | "EXAM" | "OTHER",
  status: "SCHEDULED" | "CANCELLED",
  notes, seriesId | null,
  change: { kind: "ROOM" | "TIME" | "CANCELLED", previousRoom?: { id, name }, previousStartsAt?, previousEndsAt?, changedAt } | null,
  createdAt, updatedAt }
```
`change` describes the last significant change (room, time or cancellation) so clients can show
"Moved from B12" / "Cancelled". Validation: `endsAt > startsAt`, same calendar day in APP_TIMEZONE, max 8 h,
teacher must be a TEACHER, groups/subject/room must exist.

Reading:
- `GET /api/timetable/me?from&to&subject&teacher` (auth) → `{ from, to, items, hint? }`, sorted by `startsAt`.
  Default range: current week (Mon 00:00 → next Mon 00:00, APP_TIMEZONE). Range > 62 days → 400 `RANGE_TOO_LARGE`.
  STUDENT: sessions of their group (no group → `items: []`, `hint: "NO_GROUP"`); TEACHER: sessions they teach;
  ADMIN/ALUMNI: `items: []`. Cancelled sessions are included.
- `GET /api/timetable?group|teacher|room&from&to` (auth) → same shape; at least one of group/teacher/room
  (else 400 `MISSING_FIELDS`).
- `GET /api/timetable/me/groups` (auth) → `[Group]`: STUDENT → own group (or `[]`), TEACHER → groups they teach.

Management (ADMIN):
- `POST /api/timetable/sessions` body `{ subject, teacher, groups: [id], room?, startsAt, endsAt, type, notes?, repeat?: { until: "YYYY-MM-DD" } }`
  (`repeat` = same weekday/time every week until the date, max 26 weeks) → 201 `{ items: [ClassSession], seriesId }`.
- `PATCH /api/timetable/sessions/:id` body: any of `subject, teacher, groups, room, startsAt, endsAt, type, notes, status`
  plus `scope: "occurrence" | "series"` (default occurrence; series = this and following occurrences) → 200 `{ items }`.
  `status: "CANCELLED"` cancels, `"SCHEDULED"` restores.
- `DELETE /api/timetable/sessions/:id?scope=occurrence|series` → 204. Deleting does not notify (it is for mistakes; use cancel).
- Conflicts: a SCHEDULED session overlapping another SCHEDULED one that shares the room, the teacher or any group
  → 409 `SESSION_CONFLICT`, `details.conflicts: [{ sessionId, startsAt, endsAt, reason: "ROOM" | "TEACHER" | "GROUP" }]`.
  For series every occurrence is checked; nothing is written if any conflicts.
- Change notifications: when a room change, a time change or a cancellation/restoration touches a session that
  starts in the future and within `NOTIFY_HORIZON_DAYS` (default 14), the students of the (old and new) groups and
  the (old and new) teacher get a `TIMETABLE_CHANGE` notification + push, e.g.
  fr: "Bases de données : salle changée B12 → A04 (mar. 8 oct., 10:30)",
  en: "Databases: room changed B12 → A04 (Tue, Oct 8, 10:30)". Link: `/dashboard/timetable?date=<YYYY-MM-DD>`.
  A series update sends one notification per user, not one per occurrence.
- `POST /api/timetable/import` (multipart: `file` = CSV UTF-8, `,` or `;` separator; `dryRun` = `true|false`)
  Columns: `date` (YYYY-MM-DD), `start` (HH:mm), `end` (HH:mm), `subject_code`, `teacher_email`,
  `groups` (group names separated by `|`), `room` (optional, room name), `type` (optional), `notes` (optional).
  → 200 `{ dryRun, created, rows }` when valid; 422 `IMPORT_INVALID` with `details: { errors: [{ line, code, message }], conflicts: [{ line, sessionId, reason }] }`
  otherwise. All-or-nothing. Max 2000 rows, 2 MB.

Calendar export:
- `GET /api/timetable/me/calendar-link` (auth) → `{ url }` = `<PUBLIC_API_URL>/api/timetable/ics/<calendarToken>.ics`
  (token created on first call); `POST /api/timetable/me/calendar-link/reset` → new `{ url }`, old token stops working.
- `GET /api/timetable/ics/:token.ics` (no auth) → `text/calendar` (RFC 5545, UTC times, `STATUS:CANCELLED` for
  cancelled sessions) of the user's sessions from 30 days ago to 120 days ahead. Unknown token → 404.

## 7. Module 7 — Announcements — `/api/announcements`

Announcement JSON:
```
{ id, title, body, priority: "LOW" | "NORMAL" | "HIGH" | "URGENT",
  audience: { roles: [Role], programs: [{ id, name, code }], levels: [int], groups: [{ id, name }] },
  attachments: [ { id, filename, size, mimeType } ],
  author: { id, firstname, lastname, role },
  status: "DRAFT" | "SCHEDULED" | "PUBLISHED",
  publishAt | null, publishedAt | null, createdAt, updatedAt,
  read?: boolean,                                   // recipient views
  stats?: { recipients, reads, readRate } }         // author/admin views
```
- `title` 1..200 chars, `body` 1..10000 chars, plain text (clients keep line breaks, never render HTML).
- Audience: a user receives it when (roles empty OR role ∈ roles) AND (programs empty OR group.program ∈ programs)
  AND (levels empty OR group.level ∈ levels) AND (groups empty OR group ∈ groups). Empty audience = everyone.
  Program/level/group criteria only match users that have a group.
- Who can write: ADMIN (any audience); TEACHER only with a non-empty `groups` list made of groups they teach
  (ClassSession) and `roles` empty or `["STUDENT"]`, else 403 `AUDIENCE_NOT_ALLOWED`. Others → 403 `FORBIDDEN`.
- `recipients` is snapshotted at publish time; `reads` = AnnouncementRead count; `readRate` = reads / recipients (0..1).

Recipient endpoints (auth):
- `GET /api/announcements?page&limit&unread=true&priority=` → paginated feed of PUBLISHED announcements the user
  receives, newest `publishedAt` first, each with `read`.
- `GET /api/announcements/:id` → visible to recipients (when published), the author and admins; else 404 `RESOURCE_NOT_FOUND`.
- `POST /api/announcements/:id/read` → 204, idempotent (recipients only).
- `GET /api/announcements/:id/attachments/:attachmentId` → file stream (`Content-Disposition: attachment`), same visibility.

Management (ADMIN, TEACHER):
- `GET /api/announcements/manage?status&page&limit` → own announcements (ADMIN: all), with `stats`.
- `POST /api/announcements` — JSON, or multipart with a `data` field (JSON) and up to 5 `attachments`
  (≤ `MAX_UPLOAD_MB` each, default 10; pdf, png, jpg, webp, docx, xlsx, pptx, txt).
  `data = { title, body, priority, audience, action: "draft" | "publish" | "schedule", publishAt? }` → 201.
  `publish` → PUBLISHED now + notifications; `schedule` → SCHEDULED, `publishAt` ≥ now + 1 min (else 400 `VALIDATION_ERROR`).
- `PATCH /api/announcements/:id` — same body shape plus `removeAttachments: [id]`. DRAFT/SCHEDULED: any field;
  PUBLISHED: only title/body/priority (no new notification); audience change on PUBLISHED → 409 `INVALID_STATE`.
- `POST /api/announcements/:id/publish` → DRAFT/SCHEDULED → PUBLISHED now (else 409 `INVALID_STATE`).
- `DELETE /api/announcements/:id` → 204 (author or admin); deletes files and reads.
- `GET /api/announcements/:id/stats` → `{ recipients, reads, readRate, readsByDay: [{ date, count }] }`.
- `POST /api/announcements/audience-preview` body `{ audience }` → `{ recipients }` (same teacher restrictions).
- Scheduler: every `SCHEDULER_INTERVAL_MS` (default 30000) due SCHEDULED announcements are published, claimed
  atomically (`findOneAndUpdate`) so two backend instances never publish twice.
- Publishing notifies every recipient (type `ANNOUNCEMENT`, link `/dashboard/announcements/<id>`, title prefixed with
  "[Urgent]" / "[Important]" for URGENT/HIGH in the recipient's language), in batches, without blocking the response.
- File errors: 413 `FILE_TOO_LARGE`, 415 `UNSUPPORTED_FILE_TYPE`, 400 `TOO_MANY_FILES`.
- Files go through `storageService` (`save`, `stream`, `remove`) on local disk (`STORAGE_DIR`), so S3 can replace it later.

## 8. Hardening (from the first review)

Backend:
- `express-rate-limit` on `/api/auth/login`, `/verify-otp`, `/forgot-password`, `/signup`, keyed by IP + normalized
  email → 429 `TOO_MANY_REQUESTS`. Env: `RATE_LIMIT_ENABLED` (default true), `RATE_LIMIT_WINDOW_MS` (900000),
  `RATE_LIMIT_AUTH_MAX` (20).
- `app.set('trust proxy', TRUST_PROXY)` (default `loopback`); the audit log and stored sessions use the real client IP/UA.
- forgot-password responds before the email is sent; reset tokens are consumed atomically (`findOneAndUpdate`).
- In production (`NODE_ENV=production`) without SMTP, sending email fails (no OTP/reset link in logs).
- Email templates use the charter indigo `#253C6D` and the user's `locale` (French uses "tu").
- Remove the unused `passport` dependency.

Web:
- `safeNextPath` rejects normalized results starting with `//` or `/\` (e.g. `/.//evil.com`).
- `lib/api.ts` and the BFF forward `X-Forwarded-For` and `User-Agent` of the browser request.
- When "Keep me signed in" is unchecked, `cl_access` is a session cookie too.
- `/auth/expired` only clears cookies for same-origin navigations (`Sec-Fetch-Site` `same-origin` or `none`).
- Security headers in `next.config.ts`: `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Content-Type-Options: nosniff`, `Permissions-Policy` (camera/microphone/geolocation off for now).
- Dark-mode "Log out" button keeps readable contrast.
- `next.config.ts`: `distDir: process.env.NEXT_DIST_DIR || ".next"` (parallel builds and tests).

## 9. Web app (Next.js)

### 9.1 Languages
- `next-intl` **without** locale routing. Locale cookie `NEXT_LOCALE` (`fr` | `en`).
  Resolution: cookie → `Accept-Language` (first of fr/en) → `fr`. At login/signup the cookie is set from / saved to
  `user.locale`. French uses "tu", warm and simple wording (spec §5.5).
- Messages: `next/messages/<locale>/<namespace>.json` with namespaces `common, landing, auth, dashboard, account,
  admin, notifications, offline, timetable, announcements`. Dates/times via next-intl formatters in the campus timezone.
- Language switcher on the landing header, the auth pages and the app shell: a select labelled "Language" (en) /
  "Langue" (fr) with options "English" / "Français". Signed in → also `PATCH /me { locale }`.
- **English texts listed in this document and in the previous UI contract must stay exactly as written**: the Playwright
  suite runs in English (Chromium sends `Accept-Language: en-US`). French texts are free but must be complete.

### 9.2 BFF and data layer
- Route handler `/bff/[...path]` forwards to `API_URL/api/<path>` with the access token from the cookies
  (refreshes on `TOKEN_EXPIRED` and sets the new cookies). `/bff/auth/*` → 404. Non-GET requests need a same-origin
  `Origin` header (else 403 `FORBIDDEN`). Passes JSON, multipart uploads, and binary/ICS downloads through, plus
  `X-Forwarded-For` / `User-Agent`. A 401 that cannot be refreshed is returned as-is (client redirects to /login).
- `useOfflineQuery(key, path)`: stale-while-revalidate on top of IndexedDB (db `campuslink`, store `cache`):
  returns saved data immediately with its `savedAt`, then revalidates from `/bff/...` when online.
- `queueMutation({ method, path, body })`: runs now when online; otherwise (or on network failure) stores it in the
  IndexedDB `outbox` store and replays it on reconnection and through Background Sync (`sync` event, tag
  `campuslink-outbox`) where supported. Idempotent operations only in phase 1 (mark as read). Last write wins.
- Logout clears IndexedDB, Cache Storage and removes the push subscription (`DELETE /bff/push/subscriptions`).

### 9.3 PWA (Module 8)
- `app/manifest.ts`: name/short_name "CampusLink", `start_url` "/dashboard", `display` "standalone",
  `theme_color` "#253C6D", `background_color` "#FFFFFF", icons 192 and 512 px + maskable. Installable.
- Service worker `/sw.js`, scope `/`, registered in production builds (or when `NEXT_PUBLIC_ENABLE_SW=true`):
  - precache `/offline` and the icons; cache-first for `/_next/static/*`, fonts and icons;
  - network-first for page navigations with fallback to the cached page, then `/offline`;
  - never caches `/bff/*` responses, Server Actions, auth routes or non-GET requests (data lives in IndexedDB);
  - `push` → `showNotification(title, { body, icon, badge, tag, data: { link } })`; `notificationclick` → focus/open `link`;
  - `sync` (`campuslink-outbox`) → replays the outbox.
- `/offline` page (public): explains the app is offline and links to the timetable/announcements cached views.
- Connectivity banner (`role="status"`) while offline: en "You're offline. Showing saved data." (+ "Last updated <time>"
  on data pages), fr "Tu es hors ligne. Affichage des données enregistrées.". Pending outbox items:
  en "{count, plural, one {# change} other {# changes}} waiting to sync".

### 9.4 Pages (all under `/dashboard` are protected by `proxy.ts`)

App shell: `nav` with `aria-label` "Main navigation"; links (en): "Home", "Timetable", "Announcements",
"Notifications" (unread badge; accessible name "Notifications" + count), "Account"; for ADMIN a group
"Administration": "Users", "Academic structure", "Timetable management", "Announcements management", "Audit log";
TEACHER also sees "Announcements management". Mobile: bottom navigation. Visiting an admin page without the role
redirects to `/dashboard`.

| Path | Content (key English labels) |
|---|---|
| `/dashboard` | h1 "Welcome, <firstname>" (unchanged), role, today's classes widget, latest announcements widget, unread notifications |
| `/dashboard/timetable` | h1 "Timetable"; buttons "Day", "Week", "Month", "Previous", "Next", "Today"; selects "Subject", "Teacher"; query `?view=day|week|month&date=YYYY-MM-DD`; each session is an `article` with subject, time range (e.g. "08:30–10:00"), room, teacher; cancelled → "Cancelled"; room change → "Moved from <room>"; empty → "No classes in this period."; button "Export" with "Copy calendar link", "Download .ics", "Add to Google Calendar"; students without group see "You're not assigned to a group yet." |
| `/dashboard/announcements` | h1 "Announcements"; checkbox "Unread only"; items with title, priority badge ("Urgent", "High", "Normal", "Low"), "New" when unread |
| `/dashboard/announcements/[id]` | h1 = title; body with line breaks; attachments as download links (filename); marks as read (queued when offline) |
| `/dashboard/notifications` | h1 "Notifications"; button "Mark all as read"; each item links to its `link` |
| `/dashboard/account` | h1 "Account"; "Profile" (fields "First name", "Last name", button "Save profile"); "Language" (select "Language"); "Security" (switch "Two-step verification"; fields "Current password", "New password", "Confirm new password", button "Change password"); "Notifications" (button "Enable push notifications" / "Disable push notifications") |
| `/dashboard/admin/users` | h1 "Users"; "Search"; filter "Role"; button "Add user"; form "First name", "Last name", "Email", "Password", "Role", "Group", button "Save"; row actions "Edit", "Delete" → "Confirm delete" |
| `/dashboard/admin/academic` | h1 "Academic structure"; tabs "Programs", "Groups", "Subjects", "Rooms"; buttons "Add program", "Add group", "Add subject", "Add room"; edit/delete with confirmation; IN_USE shown as an alert |
| `/dashboard/admin/timetable` | h1 "Timetable management"; tabs "Group", "Teacher", "Room" + select "Show timetable for"; week grid; button "Add session"; form "Subject", "Teacher", "Groups", "Room", "Date", "Start time", "End time", "Type", "Notes", checkbox "Repeat weekly", "Until", button "Save session"; conflicts → `role="alert"` containing "Conflict"; editing a session: "Save changes", "Cancel session" → "Confirm cancellation", "Delete"; for series: radio "This session only" / "This and following sessions"; button "Import CSV" → file input "CSV file", buttons "Check file", "Import", then a report |
| `/dashboard/admin/announcements` | h1 "Announcements management"; button "New announcement"; table columns "Title", "Status", "Recipients", "Read rate"; `/new` and `/[id]/edit`: "Title", "Message", "Priority", fieldset "Audience" ("Roles", "Programs", "Levels", "Groups"), live text "<n> recipients", file input "Attachments", checkbox "Publish later", "Publish at", buttons "Save draft", "Publish now", "Schedule"; `/[id]` stats with "Read rate" |
| `/dashboard/admin/audit` | h1 "Audit log"; filter "Action"; columns "Date", "Actor", "Action", "Target", "IP" |
| `/offline` | public offline fallback |

## 10. Environment variables (new)

Backend (`backend/.env.example`): `APP_TIMEZONE=Africa/Tunis`, `PUBLIC_API_URL=http://localhost:4000`,
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:admin@campuslink.local`, `PUSH_OUTBOX_FILE` (tests),
`STORAGE_DIR=uploads`, `MAX_UPLOAD_MB=10`, `SCHEDULER_INTERVAL_MS=30000`, `NOTIFY_HORIZON_DAYS=14`,
`TRUST_PROXY=loopback`, `RATE_LIMIT_ENABLED=true`, `RATE_LIMIT_WINDOW_MS=900000`, `RATE_LIMIT_AUTH_MAX=20`.

Web (`next/.env.example`): `API_URL`, `NEXT_PUBLIC_APP_TIMEZONE=Africa/Tunis`, `NEXT_PUBLIC_ENABLE_SW`,
`NEXT_DIST_DIR`, `COOKIE_SECURE`.

## 11. Demo data

`npm run seed:demo` (backend, refuses to run with `NODE_ENV=production`, idempotent): programs, groups (level 4,
current academic year), subjects, rooms, teachers and students (password `Campus123!`), then every
`backend/scripts/seed/*.js` module in name order (timetable: weekly series for the current and next 4 weeks;
announcements: a few published, one scheduled). Prints the demo accounts.

## 12. File ownership (parallel work)

| Owner | Files |
|---|---|
| Backend foundation | `backend/app.js`, `models/{userModel,programModel,groupModel,subjectModel,roomModel,notificationModel,pushSubscriptionModel,auditLogModel}.js`, `controllers/{auth,user,academic,notification,push,audit}Controller.js`, `routes/{auth,user,academic,notifications,push,audit}.js`, `middleware/*`, `service/{mail,token,notification,push,audit,audience,storage}Service.js`, `service/scheduler.js`, `utils/*`, `scripts/{create-admin,generate-vapid,seed-demo}.js`, `package.json` (installs **all** backend deps: `express-rate-limit`, `web-push`, `multer`, `csv-parse`), `.env.example`, root `.gitignore`. Creates **stub routers** `routes/timetable.js` and `routes/announcements.js` already mounted in `app.js`. |
| Backend timetable | `models/classSessionModel.js`, `controllers/timetableController.js`, `routes/timetable.js`, `service/timetableService.js`, `service/icsService.js`, `service/timetableImport.js`, `scripts/seed/10-timetable.js` |
| Backend announcements | `models/{announcementModel,announcementReadModel}.js`, `controllers/announcementController.js`, `routes/announcements.js`, `service/announcementService.js`, `scripts/seed/20-announcements.js` |
| Web foundation | everything in `next/` except the module folders below; installs **all** web deps (`next-intl`, `idb`, Radix primitives…); creates shared UI primitives in `components/ui/` (dialog, select, tabs, badge, table, switch, checkbox, textarea, dropdown menu…), the app shell, BFF, data layer, PWA, i18n, account/admin users/academic/audit/notifications pages, **placeholder** module pages and widgets, and the `timetable.json` / `announcements.json` message files. `next/.gitignore`. |
| Web timetable | `app/(back)/dashboard/timetable/**`, `app/(back)/dashboard/admin/timetable/**`, `components/timetable/**`, `lib/timetable/**`, `messages/{fr,en}/timetable.json` |
| Web announcements | `app/(back)/dashboard/announcements/**`, `app/(back)/dashboard/admin/announcements/**`, `components/announcements/**`, `lib/announcements/**`, `messages/{fr,en}/announcements.json` |
| Tests | `tests/**` (and test entries of the root `.gitignore`) |

Module agents never install packages and never edit files owned by someone else: if they need a change there,
they report it.
