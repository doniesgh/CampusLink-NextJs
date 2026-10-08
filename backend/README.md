# CampusLink backend

REST API of CampusLink (Express 5 + Mongoose 9, CommonJS). The web app (`next/`) and the future Flutter app
use the same API: tokens travel in JSON bodies and `Authorization: Bearer` headers, never in cookies.
The API contract of phase 1 is [`docs/phase1-contract.md`](../docs/phase1-contract.md).

## Run

```bash
cd backend
npm install
cp .env.example .env        # then set MONGO_URI and JWT_SECRET (see the comments in the file)
npm run generate-vapid      # optional: web push keys, paste the lines into .env
npm run dev                 # nodemon, or `npm start`
```

| Script                   | What it does                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `npm start` / `npm run dev` | Starts the API on `PORT` (default 4000).                                                     |
| `npm run create-admin -- <email> <password> [firstname] [lastname]` | Creates an ADMIN, or promotes an account and sets its password. |
| `npm run generate-vapid` | Prints a new VAPID key pair for `.env` (`-- --json` prints `{ publicKey, privateKey }`).       |
| `npm run seed:demo`      | Demo data (refuses `NODE_ENV=production`, idempotent). Every demo account uses `Campus123!`.  |

Environment variables are documented in [`.env.example`](.env.example). Values already set in the shell take
precedence over `.env` (tests rely on this).

Useful settings for automated tests: `RATE_LIMIT_ENABLED=false`, `MAIL_OUTBOX_FILE=<file>` (emails as JSON
lines), `PUSH_OUTBOX_FILE=<file>` (pushes as JSON lines instead of sending them), `SCHEDULER_INTERVAL_MS=<ms>`,
`STORAGE_DIR=<dir>`, `SEED_PLUGINS_DIR=<dir>` (other folder of seed plugins).

## Layout

```
app.js                 Express app; start() connects MongoDB, creates indexes, starts the scheduler
routes/                one router per prefix (/api/auth, users, academic, notifications, push, audit,
                       timetable, announcements)
controllers/           request handlers
models/                Mongoose models (model names are part of the contract)
service/               business services (mail, tokens, notifications, push, audit, audience, storage, scheduler)
middleware/            requireAuth/requireRole, optionalAuth, upload, rateLimit, logger, errorHandler
utils/                 HttpError, validation, env, time (campus timezone), serialize, pushEndpoint
scripts/               create-admin, generate-vapid, seed-demo (+ seed/*.js plugins of the modules)
```

## Conventions

- Errors: `throw new HttpError(status, CODE, 'English message', details?)` anywhere in a handler (Express 5
  forwards async errors). The error handler answers `{ error, code, details? }` and turns Mongoose errors into
  `400 VALIDATION_ERROR` (details per field), `400 INVALID_ID` (cast errors) and `409 ALREADY_EXISTS`
  (`details.field`, duplicate key). Unknown errors give `500 INTERNAL_ERROR` without the stack.
- Every model has a `toJSON` transform: string `id`, no `_id` / `__v` / secrets. Send documents with `res.json(doc)`.
- Paginated lists: `{ items, total, page, limit }` (`parsePagination`, limit max 100).
- Dates are stored in UTC; anything "per day / per week" uses `APP_TIMEZONE` through `utils/time.js`.
- Look up another module's model with `mongoose.models.<Name>` and check that it is registered.

## Sessions and rate limiting — `/api/auth`

- **Sessions.** Login, signup and verify-otp open a session: one `RefreshToken` document (SHA-256 of the token)
  with a random `sessionId`. The access token carries it as the `sid` claim (`req.sessionId`). `POST /refresh`
  rewrites that document in place (new token hash and expiry, single-use as before), so the session keeps its
  `sessionId`; a session opened before session ids existed gets one on its next refresh. `POST /logout` deletes the
  session, its push subscriptions and closes its real-time (Socket.IO) connections. Password change/reset, admin
  password changes and account deletion revoke every session, push subscription and real-time connection of the
  user (`tokenService.revokeAllRefreshTokens`); a role change closes the user's real-time connections too
  (`realtime.disconnectUser`, see [`docs/carpool.md`](docs/carpool.md) section 1).
- **Rate limits** (`middleware/rateLimit.js`, in memory, per instance): every limiter answers
  `429 TOO_MANY_REQUESTS` with a `Retry-After` header and `details.retryAfter` (seconds), and is skipped with
  `RATE_LIMIT_ENABLED=false`. The client IP is `req.ip` (`TRUST_PROXY`).

| Routes | Key | Limit per `RATE_LIMIT_WINDOW_MS` (default 15 min) |
| ------ | --- | ------------------------------------------------- |
| `signup`, `login`, `verify-otp`, `forgot-password` (each) | route + IP + normalized email | `RATE_LIMIT_AUTH_MAX` (20) |
| the same four routes together | IP (not applied to loopback callers without `X-Forwarded-For`) | `RATE_LIMIT_IP_MAX` (100) |
| `change-password` | signed-in user | `RATE_LIMIT_PASSWORD_MAX` (10) |
| `reset-password` | IP (not applied to loopback callers without `X-Forwarded-For`) | `RATE_LIMIT_RESET_MAX` (20) |
| `POST /api/bookings`, `POST /api/bookings/:id/cancel` (each) | signed-in user (ADMIN cancellations not counted) | `RATE_LIMIT_BOOKING_CREATE_MAX` / `RATE_LIMIT_BOOKING_CANCEL_MAX` (30) per `RATE_LIMIT_BOOKING_WINDOW_MS` (1 h), see `docs/bookings.md` |

Other per-user limits are built with `userRateLimit({ name, limitEnv, defaultLimit, windowEnv, defaultWindowMs, skip })`
from `middleware/rateLimit.js`, mounted after `requireAuth`.

The per-email limiter runs before the per-IP one, so requests it refuses do not use up the budget of everyone
behind the same address (campus NAT). `refresh` and `logout` are not limited.

The two IP-only limiters are not applied when `req.ip` is a loopback address (`127.0.0.0/8`, `::1`,
`::ffff:127.x.x.x`), i.e. a caller on this host that sent no `X-Forwarded-For`: the Next.js web app relays every
browser from loopback, and without a forwarded client address one counter would be shared by all web users (one
person sending bad logins would lock everyone out). Such requests keep the route + IP + email limit. Set
`TRUSTED_PROXY_HOPS` on the web app so it forwards the client IP (production: nginx in front of Next.js and
`TRUSTED_PROXY_HOPS=1`, see `next/README.md`); behind a proxy that writes `X-Forwarded-For`, `req.ip` is the real
client and the per-IP limits apply to web users and to direct API clients (mobile app) alike.

## Timetable module — `/api/timetable` (Module 1)

Code: `models/classSessionModel.js`, `controllers/timetableController.js`, `service/timetableService.js`
(ranges, conflicts, series, notifications), `service/timetableImport.js` (CSV), `service/icsService.js` (iCalendar).

| Endpoint | Who | Answer |
| -------- | --- | ------ |
| `GET /me?from&to&subject&teacher` | any | `{ from, to, items, hint? }`: STUDENT = their group (`hint: "NO_GROUP"` without one), TEACHER = sessions they teach, others `[]` |
| `GET /?group\|teacher\|room&from&to&subject` | any | `{ from, to, items }`; at least one of group/teacher/room (else `400 MISSING_FIELDS`) |
| `GET /me/groups` | any | STUDENT: own group; TEACHER: groups they teach (see below) |
| `GET /sessions/:id` | any | ClassSession |
| `POST /sessions` | ADMIN | `201 { items, seriesId }` |
| `PATCH /sessions/:id` | ADMIN | `200 { items }` (every occurrence of the scope) |
| `DELETE /sessions/:id?scope=` | ADMIN | `204`, no notification (for mistakes; cancel instead) |
| `POST /import` | ADMIN | multipart CSV, see below |
| `GET /me/calendar-link`, `POST /me/calendar-link/reset` | any | `{ url }` of the ICS feed |
| `GET /ics/:token.ics` | no auth | `text/calendar` (inline) |
| `GET /me/calendar.ics` | any | the same calendar as a download (`attachment`) |

- **Ranges**: `from`/`to` are `YYYY-MM-DD` (00:00 campus time), campus wall-clock `YYYY-MM-DDTHH:mm` or ISO with
  an offset; `to` is exclusive. Default: the current week (Monday 00:00 → next Monday). More than 62 days →
  `400 RANGE_TOO_LARGE`. Cancelled sessions are included.
- **Validation**: `endsAt > startsAt`, same day in `APP_TIMEZONE`, at most 8 h; `teacher` must be a TEACHER;
  1 to 20 groups; subject, groups and room must exist; notes ≤ 1000 characters; `type` ∈ LECTURE, TUTORIAL, LAB, EXAM, OTHER.
- **Series**: `repeat: { until: "YYYY-MM-DD" }` on create makes a weekly series (same weekday and wall-clock time,
  DST-safe, at most 26 occurrences) sharing a `seriesId`. `PATCH` and `DELETE` take `scope` (body or query):
  `occurrence` (default) or `series` = this occurrence and the following ones of its series. In a series update,
  a time change moves every following occurrence by the same number of days to the new wall-clock times; sending
  only `startsAt` keeps the duration. `status: "CANCELLED"` cancels, `"SCHEDULED"` restores. `change`
  (`ROOM` | `TIME` | `CANCELLED`, with the previous room/times) tells clients "Moved from B12" / "Cancelled".
- **Conflicts**: a SCHEDULED session overlapping another SCHEDULED one with the same room, teacher or any group →
  `409 SESSION_CONFLICT`, `details.conflicts: [{ sessionId, startsAt, endsAt, reason: ROOM | TEACHER | GROUP,
  subject }]`. Every occurrence of a series is checked and nothing is written if one conflicts. Cancelled sessions
  never conflict; restoring one is checked.
- **Notifications**: a room change, time change, cancellation or restoration of a session that starts in the
  future and within `NOTIFY_HORIZON_DAYS` (14) sends one `TIMETABLE_CHANGE` notification + push per user (students
  of the old and new groups, old and new teacher), even for a whole series; link `/dashboard/timetable?date=…`.
- **Groups a teacher teaches** (`/me/groups` and the announcement audience rule): groups of the teacher's
  **SCHEDULED** sessions of the **current academic year** (1 September → 31 August, `APP_TIMEZONE`);
  `timetableService.taughtSessionsFilter(teacherId)`.
- **CSV import** (`POST /import`, multipart `file`, optional `dryRun=true|false`): UTF-8, `,` or `;` separator
  (detected on the header line), at most 2000 rows and 2 MB. Columns (any order, header names as below):

  ```csv
  date,start,end,subject_code,teacher_email,groups,room,type,notes
  2026-10-12,08:30,10:00,BDD,amira.bensalah@campuslink.local,4TWIN1|4TWIN2,Amphi A,LECTURE,
  ```

  `date` `YYYY-MM-DD` and `start`/`end` `HH:mm` are campus times; `groups` are group names separated by `|`;
  `room` (room name), `type` (default LECTURE) and `notes` are optional. All-or-nothing: valid →
  `200 { dryRun, created, rows }` (`created: 0` with `dryRun`); otherwise `422 IMPORT_INVALID` with
  `details: { errors: [{ line, code, message, column? }], conflicts: [{ line, sessionId, reason, ... }], rows }`
  (`line` = line in the file, header = 1). Error codes: `INVALID_ENCODING`, `CSV_PARSE_ERROR`, `EMPTY_FILE`,
  `TOO_MANY_ROWS`, `MISSING_COLUMNS`, `UNKNOWN_COLUMNS`, `DUPLICATE_COLUMNS`, `TOO_MANY_VALUES`, `MISSING_VALUE`,
  `INVALID_DATE`, `INVALID_TIME`, `INVALID_TIME_RANGE`, `UNKNOWN_SUBJECT`, `UNKNOWN_TEACHER`, `NOT_A_TEACHER`,
  `UNKNOWN_GROUP`, `TOO_MANY_GROUPS`, `UNKNOWN_ROOM`, `INVALID_TYPE`, `NOTES_TOO_LONG`. Conflicts are reported
  against existing sessions and between rows of the file (`otherLine`).
- **ICS feed**: `GET /me/calendar-link` → `{ url: "<PUBLIC_API_URL>/api/timetable/ics/<token>.ics" }`, stable
  until reset. `<token>` = `base64url(user id, 12 bytes)` + `.` + `base64url(HMAC-SHA256(JWT_SECRET,
  "<userId>:<calendarNonce>"))`; only the random nonce is stored (`select: false`) and the token is checked with
  `timingSafeEqual`. `POST /me/calendar-link/reset` replaces the nonce (old URL → 404, audited as
  `timetable.calendar_link.reset`). Changing `JWT_SECRET` changes every URL. Accounts that still hold a clear-text
  `calendarToken` from before get a nonce (and lose that field) on their next calendar-link call; their old URL
  answers 404. The feed (RFC 5545, UTC times, `UID:<sessionId>@campuslink`, `SEQUENCE` bumped on each change,
  `STATUS:CANCELLED` for cancelled sessions, `REFRESH-INTERVAL` 1 h, titles in the user's locale) holds the user's
  sessions from 30 days ago to 120 days ahead. Unknown, malformed or reset token → `404 RESOURCE_NOT_FOUND`.

## Announcements module — `/api/announcements` (Module 7)

Code: `models/announcementModel.js`, `models/announcementReadModel.js`, `controllers/announcementController.js`,
`service/announcementService.js` (visibility, teacher rule, publication, scheduler, stats), `service/audienceService.js`.

| Endpoint | Who | Answer |
| -------- | --- | ------ |
| `GET /?page&limit&unread=true&priority=HIGH,URGENT` | any | `{ items, total, page, limit, unreadCount }`: PUBLISHED announcements the user receives, newest first, each with `read` |
| `GET /:id` | recipients, author, admins | announcement (+ `read` / `stats`); others `404 RESOURCE_NOT_FOUND` |
| `POST /:id/read` | any | `204`, idempotent (only recipients' reads are stored) |
| `GET /:id/attachments/:attachmentId` | same as `GET /:id` | file, `Content-Disposition: attachment` with the UTF-8 name |
| `GET /manage?status&page&limit` | ADMIN, TEACHER | own announcements (ADMIN: all) with `stats` |
| `POST /` | ADMIN, TEACHER | `201` announcement |
| `PATCH /:id` | author, ADMIN | `200` announcement |
| `POST /:id/publish` | author, ADMIN | DRAFT/SCHEDULED → PUBLISHED now, else `409 INVALID_STATE` |
| `DELETE /:id` | author, ADMIN | `204`; deletes files, reads and the related notifications |
| `GET /:id/stats` | author, ADMIN | `{ recipients, reads, readRate, readsByDay: [{ date, count }] }` |
| `POST /audience-preview` `{ audience }` | ADMIN, TEACHER | `{ recipients }` (same teacher rule) |

- **Body** (JSON, or multipart with a `data` field holding the JSON): `{ title (1..200), body (1..10000, plain
  text), priority: LOW | NORMAL | HIGH | URGENT, audience, action: "draft" | "publish" | "schedule", publishAt? }`;
  `schedule` needs `publishAt` ≥ now + 1 min. `PATCH` takes the same fields plus `removeAttachments: [id]`:
  DRAFT/SCHEDULED can change anything; PUBLISHED only `title`, `body` and `priority` (no new notification),
  anything else → `409 INVALID_STATE`.
- **Audience** `{ roles, programs, levels, groups }`: a user receives the announcement when every non-empty
  criterion matches (role ∈ roles AND group.program ∈ programs AND group.level ∈ levels AND group ∈ groups); an
  empty audience is everyone; program/level/group criteria only match users with a group. ADMIN may address
  anyone. A TEACHER needs a non-empty `groups` list of groups they teach (SCHEDULED sessions of the current
  academic year, see the timetable module) and `roles` empty or `["STUDENT"]`, else `403 AUDIENCE_NOT_ALLOWED`
  (`details.reason`: `ROLES_NOT_ALLOWED` | `GROUPS_REQUIRED` | `GROUP_NOT_TAUGHT`); other roles `403 FORBIDDEN`.
- **Attachments**: up to 5 per announcement (multipart field `attachments`), each ≤ `MAX_UPLOAD_MB` (10): pdf, png,
  jpg/jpeg, webp, docx, xlsx, pptx, txt; MIME type, extension and content (magic bytes) must match. Errors:
  `413 FILE_TOO_LARGE`, `415 UNSUPPORTED_FILE_TYPE`, `400 TOO_MANY_FILES`. Files are saved through
  `storageService` (folder `announcements`, see "Files" below) and keep their original (UTF-8) name for downloads.
- **Publication**: publishing (now, `POST /:id/publish` or the scheduler) is claimed atomically, snapshots
  `recipients`, records `announcement.publish` and notifies every recipient except the author (`ANNOUNCEMENT`,
  link `/dashboard/announcements/<id>`, title prefixed `[Urgent]` / `[Important]` for URGENT / HIGH, push urgency
  from the priority), in the background for HTTP requests.
- **Scheduler**: job `announcements.publish-due` every `SCHEDULER_INTERVAL_MS` (30 s) publishes the due SCHEDULED
  announcements (at most 50 per run), each claimed with `findOneAndUpdate`, so several backend instances never
  publish or notify twice.
- **Stats**: PUBLISHED → `recipients` snapshotted at publish time, `reads` = AnnouncementRead count, `readRate` =
  reads / recipients (0..1); DRAFT/SCHEDULED → `recipients` = users matching the audience now, no reads.
  `readsByDay` lists every day (campus timezone) from the publication day to today, zeros included (at most 400 days).

## Internal services for modules

All paths are relative to `backend/`.

### Auth middleware — `middleware/requireAuth.js`

```js
const { requireAuth, requireRole } = require('../middleware/requireAuth');
router.get('/me', requireAuth, handler);                       // 401 AUTH_REQUIRED / TOKEN_EXPIRED / INVALID_TOKEN
router.post('/', requireAuth, requireRole('ADMIN', 'TEACHER'), handler);   // 403 FORBIDDEN
```

`req.user` is the full User document (role read from the database). Its `group` is **populated**:
`req.user.group = { _id, name, level, academicYear, program: { _id, name, code } } | null`.
`req.sessionId` is the login session of the access token (its `sid` claim, see "Sessions" below), or `null`
for a token issued before sessions had ids (such tokens keep working until they expire).
`middleware/optionalAuth.js` sets `req.user` (and `req.sessionId`) when a valid token is present and continues
anonymously otherwise.

### User model — `models/userModel.js`

Fields added in phase 1: `locale` (`'fr' | 'en'`, default `'fr'`), `group` (ObjectId → Group, students only),
`calendarNonce` (`select: false`: random secret of the ICS feed URL, see the timetable module below; the URL
token itself is never stored).

- Every `User.find*()` query populates `group` (+ its program) automatically, so serialized users have the
  public shape. It is skipped when the projection excludes `group` (`.select('firstname lastname')`,
  `Model.exists`) or with `.setOptions({ populateGroup: false })`.
- After `user.save()` with a changed group, call `await user.populateGroup()` before sending it.
- Exports: `User.ROLES`, `User.LOCALES`, `User.GROUP_POPULATE`.
- Public JSON: `{ id, firstname, lastname, email, role, twoFactorEnabled, locale, group, createdAt, updatedAt }`.

### Academic models

`Program` (`summarizeProgram(p)` → `{ id, name, code }`), `Group` (`summarizeGroup(g)` →
`{ id, name, level, academicYear, program }`; `MIN_LEVEL`, `MAX_LEVEL`, `isAcademicYear`, `NAME_COLLATION`),
`Subject` (`SUBJECT_COLORS`, `pickSubjectColor(i)`), `Room` (`ROOM_TYPES`, `NAME_COLLATION`).
Group names are unique per academic year and room names are unique, both ignoring case: query them with
`.collation(Group.NAME_COLLATION)` / `.collation(Room.NAME_COLLATION)` for case-insensitive lookups (CSV import).

`DELETE /api/academic/...` answers `409 IN_USE` with `details.references` = counts of what still points to the
resource: `{ groups?, users?, sessions?, announcements? }`. `DELETE /api/users/:id` does the same for a TEACHER
who still has SCHEDULED sessions that have not ended: `409 IN_USE`, `details.references.sessions` (reassign or
cancel them first; past and cancelled sessions do not block). Sessions are counted through
`mongoose.models.ClassSession` (`subject`, `room`, `groups` fields) and announcements through
`mongoose.models.Announcement` (`audience.programs`, `audience.groups`) when those models are registered.
A deleted account loses its sessions, push subscriptions, real-time connections and in-app notifications, and its
alumni network data is erased (`alumniService.purgeUser`: profile and posts deleted, mentoring history anonymized).

### Audit — `service/auditService.js`

```js
const auditService = require('../service/auditService');
await auditService.record(req, {
  action: 'timetable.session.cancel',    // contract section 5 names
  targetType: 'ClassSession',            // model name
  targetId: session._id,
  summary: 'Cancelled BDD for 4TWIN1 on 2026-10-08 10:30',  // short English sentence
  metadata: { scope: 'series', count: 4 },                  // secrets are redacted automatically
  // actor: user,                         // optional: overrides req.user (e.g. unauthenticated flows)
});
```

Actor = `req.user` (snapshotted), IP = `req.ip` (honours `TRUST_PROXY`), User-Agent from the request.
Never throws (failures are logged); resolves to the entry or `null`.

### Notifications — `service/notificationService.js`

```js
const { notifyUsers, notifyUsersInBackground } = require('../service/notificationService');

const report = await notifyUsers(userIds, (locale) => ({
  type: 'TIMETABLE_CHANGE',               // 'TIMETABLE_CHANGE' | 'ANNOUNCEMENT' | 'SYSTEM'
  title: locale === 'fr' ? 'Bases de données : salle changée B12 → A04 (mar. 8 oct., 10:30)'
                         : 'Databases: room changed B12 → A04 (Tue, Oct 8, 10:30)',
  body: '',
  link: '/dashboard/timetable?date=2026-10-08',   // relative web path
  data: { sessionId: String(session._id) },         // small JSON object
  tag: `session-${session._id}`,                    // optional: push tag (same tag replaces the OS notification)
  urgency: 'high',                                  // optional: web push urgency
}));
// report = { notified, push: { sent, outbox, removed, skipped, failed }, error? }
```

- `userIds`: ids, id strings or documents; duplicates, invalid and unknown ids are ignored.
- `buildMessage(locale)` is called once per locale (French uses "tu"); declare a second parameter
  `(locale, user)` to be called once per user (`user = { _id, locale }`). It may be async.
- Creates the in-app notifications in batches of 500, then pushes to every subscription of each user.
  Options: `notifyUsers(ids, build, { push: false })`.
- **Never throws and never rejects**: `notifyUsersInBackground(ids, build)` starts it on the next tick so the
  HTTP response is not delayed.

### Push — `service/pushService.js`

`isConfigured()`, `getPublicKey()`, `sendToUser(userId, payload)`, `sendToUsers([{ userId, payload }])`,
`sendToSubscription(subscriptionDoc, payload)`. Payload `{ title, body, link, tag, data }` (+ optional `urgency`).
All of them never throw and resolve to `{ sent, outbox, removed, skipped, failed }`. Subscriptions answering
404/410 are deleted; FCM subscriptions are stored and skipped in phase 1. With `PUSH_OUTBOX_FILE`, each push is
appended as `{ userId, subscriptionId, type, endpoint, payload, sentAt }` instead of being sent.
Normally you only call `notificationService.notifyUsers`, which pushes for you.

Each subscription belongs to the login session that registered it (`sessionId` = the access token's `sid`, `null`
for an old token without one). Logout (revoking that session's refresh token) deletes the session's subscriptions,
`tokenService.revokeAllRefreshTokens(userId)` (password change or reset, admin password change, account deletion)
deletes all of the user's, and the hourly job `push.prune-ended-sessions` deletes those whose session expired.
A user keeps at most 10 subscriptions: registering an 11th drops the least recently updated one.

Web push endpoints are restricted to the browser push services (`utils/pushEndpoint.js`): `https://` with no
port and no credentials, host `fcm.googleapis.com` or a subdomain of `push.services.mozilla.com`,
`notify.windows.com` or `push.apple.com`. `POST /api/push/subscriptions` refuses anything else with
400 `VALIDATION_ERROR` (`details.endpoint`), so a user cannot make the server POST to internal hosts or third
parties (SSRF). `sendToSubscription` checks again before sending (and before the outbox): a stored subscription
that fails the check is never contacted, it is deleted and counted as `removed`.

### Audience — `service/audienceService.js`

Audience = `{ roles: [Role], programs: [programId], levels: [int], groups: [groupId] }` (contract section 7).

```js
const audience = require('../service/audienceService');
const parsed = await audience.parseAudience(body.audience);  // validates; 400 VALIDATION_ERROR with
                                                              // details['audience.roles' | ...programs | ...levels | ...groups]
audience.userMatchesAudience(req.user, announcement.audience); // sync; user.group must be populated (req.user is)
const ids = await audience.resolveAudienceUserIds(parsed);     // ObjectId[] of every matching user
const count = await audience.countAudience(parsed);            // number (audience preview)
const filter = await audience.buildAudienceFilter(parsed);     // User filter, or null when nobody matches
```

Arrays may hold ids, id strings or populated documents.

### Files — `service/storageService.js` + `middleware/upload.js`

```js
const { createUpload, FILE_TYPES } = require('../middleware/upload');
const storageService = require('../service/storageService');

// Multipart (JSON requests pass through untouched, req.files = []):
router.post('/', requireAuth, createUpload({ field: 'attachments', maxCount: 5 }), async (req, res) => {
  const data = JSON.parse(req.body.data ?? '{}');           // text fields are strings
  for (const file of req.files) {                           // { originalname, mimetype, size, buffer }
    const saved = await storageService.save({
      buffer: file.buffer, originalName: file.originalname, mimeType: file.mimetype, folder: 'announcements',
    });                                                      // → { key, filename, size, mimeType }
  }
});
router.post('/import', createUpload({ field: 'file', types: FILE_TYPES.CSV, maxFileSizeMb: 2 }), handler); // req.file

await storageService.sendFile(res, key, { filename, mimeType });   // download (Content-Disposition: attachment)
const stream = await storageService.stream(key);                  // 404 RESOURCE_NOT_FOUND when missing
await storageService.remove(key);                                  // idempotent
```

- `createUpload({ field = 'file', maxCount = 1, types = FILE_TYPES.ATTACHMENTS, maxFileSizeMb = MAX_UPLOAD_MB, checkContent = true })`.
  `FILE_TYPES.ATTACHMENTS` = pdf, png, jpg/jpeg, webp, docx, xlsx, pptx, txt; `FILE_TYPES.CSV` = .csv (text/csv,
  application/vnd.ms-excel, text/plain, application/octet-stream...). MIME type **and** extension must match,
  and the content is checked (magic bytes; no NUL bytes in text files).
- Errors: `413 FILE_TOO_LARGE`, `415 UNSUPPORTED_FILE_TYPE`, `400 TOO_MANY_FILES`, `400 VALIDATION_ERROR`
  (unexpected file field, malformed multipart).
- Files are stored under generated keys (`<folder>/YYYY/MM/<32 hex>.<ext>`); store the `key` and the original
  `filename` in your model. Keys are validated (`400 VALIDATION_ERROR`, no path traversal) and written once.
- **Storage driver** (`STORAGE_DRIVER`, read at call time; same API, errors and keys for both):
  - `disk` (default): files under `STORAGE_DIR` (default `backend/uploads`, git-ignored). For local development, a
    VPS or any host with a persistent disk.
  - `gridfs`: files in MongoDB, GridFS bucket `uploads` of the mongoose connection (`uploads.files` /
    `uploads.chunks`), the key as the GridFS `filename`, `metadata: { mimeType, originalName }`. A unique index on
    `filename` (fast lookups, a key is never written twice) and the chunks index are created on the first storage
    call. For hosts without a persistent disk, such as the **Render free tier** (its disk is wiped on every
    restart and redeploy, so disk files would be lost). Files count towards the database size: the MongoDB Atlas
    free tier (M0) holds **512 MB** in all (data, files and indexes), i.e. at most about 50 files of the 10 MB
    `MAX_UPLOAD_MB` limit, fewer with the rest of the data.
  - Switching drivers does not move files: keys saved with one driver answer 404 with the other (run
    `npm run seed:demo` again for the demo files).
- `file.originalname` is UTF-8 (`defParamCharset: 'utf8'`): `filename="été.pdf"` sent as raw UTF-8 bytes, as
  browsers do, is kept as is (multer's default would read it as latin1).

### Scheduler — `service/scheduler.js`

```js
const scheduler = require('../service/scheduler');
scheduler.registerJob('announcements.publish-due', scheduler.defaultIntervalMs(), async () => {
  // claim work atomically (findOneAndUpdate): several backend instances may run the same job
});
```

`registerJob(name, intervalMs, fn, { runOnStart = true })` → `{ stop, runNow }`. Register at module load time:
`app.js` starts the jobs after the MongoDB connection (first run ~1 s later) and stops them on shutdown. A job
never overlaps itself (next run = end of the previous one + interval), errors are logged, timers are unref'd.
Jobs never run when `app.js` is only imported (`require('./app')`), e.g. by scripts.

### Validation helpers — `utils/validation.js`

- Throwing: `requireFields(body, fields)` (400 `MISSING_FIELDS` then `VALIDATION_ERROR` for non-strings),
  `throwIfInvalid(details)`, `assertObjectId(id)` (400 `INVALID_ID`), `notFound('Announcement')`
  (→ `HttpError` 404 `RESOURCE_NOT_FOUND`, to throw), `validationError(details)`.
- Collecting (`details` is a `{ field: message }` object, call `throwIfInvalid(details)` afterwards):
  `readString(v, field, details, { min, max })`, `readInteger(v, field, details, { min, max })`,
  `readEnum(v, allowed, field, details)`, `readDate(v, field, details)`, `readBoolean(v, field, details)`,
  `readObjectId(v, field, details)`, `readObjectIdList(v, field, details, { max })`.
- Other: `parsePagination(req.query)` → `{ page, limit, skip }`, `parseBooleanQuery(v)`, `escapeRegex(s)`,
  `normalizeEmail(s)`, `normalizeLocale(s)`, `checkPassword(pw)`, `LOCALES`.

### Time helpers — `utils/time.js` (campus timezone, weeks start on Monday)

`getAppTimezone()`, `parseLocalDateTime('2026-10-08', '10:30')` → Date (UTC) or null,
`formatLocalDate(date)` → `'YYYY-MM-DD'`, `formatLocalTime(date)` → `'HH:mm'`, `startOfLocalDay(date)`,
`startOfLocalWeek(date)` (Monday 00:00), `addLocalDays(date, n)`, `addDaysToDateString('2026-10-08', 7)`,
`isSameLocalDay(a, b)`, `getZonedParts(date)` (`weekday` 1 = Monday), `parseDateOnly`, `parseTimeOnly`,
`currentAcademicYear()` (`'2026-2027'`, starts in September), `academicYearBounds(date)` → `{ start, end }`
(1 September 00:00 of that academic year and of the next one, end exclusive). All take an optional timezone last.

### Other helpers

- `utils/env.js`: `envString`, `envBool`, `envNumber(name, fallback)` (e.g. `envNumber('NOTIFY_HORIZON_DAYS', 14)`),
  `isProduction()`, `publicApiUrl()` (`PUBLIC_API_URL` without trailing slash).
- `utils/serialize.js`: `idOf(value)`, `isPopulated(value)`, `refSummary(value, ['name', 'code'])`, `cleanTransform(hidden)`.
- `service/mailService.js`: `sendEmail({ to, subject, text, html })` (throws on failure; fails in production
  without SMTP), `escapeHtml`, `BRAND_COLOR`.

### Error codes

Existing: `AUTH_REQUIRED`, `TOKEN_EXPIRED`, `INVALID_TOKEN`, `FORBIDDEN`, `MISSING_FIELDS`, `VALIDATION_ERROR`,
`INVALID_ID`, `INVALID_JSON`, `PAYLOAD_TOO_LARGE`, `NOT_FOUND` (unknown route), `NO_CHANGES`, `USER_NOT_FOUND`,
`EMAIL_TAKEN`, `INVALID_ROLE`, `INVALID_CREDENTIALS`, `OTP_INVALID`, `OTP_TOO_MANY_ATTEMPTS`,
`INVALID_REFRESH_TOKEN`, `RESET_TOKEN_INVALID`, `INVALID_PASSWORD`, `CANNOT_DELETE_SELF`, `EMAIL_FAILED`.
Phase 1: `RESOURCE_NOT_FOUND` (404), `ALREADY_EXISTS` (409, `details.field`), `IN_USE` (409,
`details.references`), `INVALID_STATE` (409), `TOO_MANY_REQUESTS` (429, `details.retryAfter`),
`RANGE_TOO_LARGE` (400), `PUSH_DISABLED` (503), `FILE_TOO_LARGE` (413), `UNSUPPORTED_FILE_TYPE` (415),
`TOO_MANY_FILES` (400). Module codes: `SESSION_CONFLICT`, `IMPORT_INVALID`, `AUDIENCE_NOT_ALLOWED`.

### Seed plugins — `scripts/seed/*.js`

`npm run seed:demo` creates the core data, then runs every `scripts/seed/*.js` in name order
(`10-timetable.js`, `20-announcements.js`). A plugin exports `async (ctx) => {}` (or `{ name, run }`) and must
be idempotent (delete what it created before, or upsert). It must not send notifications.

```js
ctx = {
  academicYear,                        // '2026-2027'
  programs: { TWIN, DS, SAE },         // documents by code
  groups: { '4TWIN1', '4TWIN2', '4DS1', '4SAE1' },   // documents by name (level 4)
  subjects: { BDD, WEB, ML, ARCH, ENG, AGILE },       // documents by code
  rooms: { A04, A12, B12, C201, C202, 'Amphi A' },    // documents by name
  users: { admin, teachers: [4], students: [13], alumni: [1], studentsByGroup: { '4TWIN1': [3], ... }, byEmail },
  teaching: [{ subject, teacher, groups: [group] }],  // suggested "who teaches what to whom"
  mongoose, models,                    // mongoose.models
  time,                                // utils/time.js
  timezone, now, password,             // 'Africa/Tunis', Date, 'Campus123!'
  log(message),                        // indented console output
}
```

Demo accounts: `admin@campuslink.local`, teachers `amira.bensalah@`, `karim.trabelsi@`, `leila.gharbi@` (en),
`mehdi.jaziri@`, students such as `yasmine.haddad@campuslink.local` (4TWIN1) and `skander.mejri@` (no group),
alumni `selim.rekik@`; all with the password `Campus123!`.

## Phase 2 modules

Each phase 2 module documents itself (see also docs/phase2-contract.md):

- [Bookings (module 5)](docs/bookings.md)
- [Forum (module 4)](docs/forum.md)
- [Attendance, grades and analytics (module 9)](docs/analytics.md)

## Phase 3 modules

See also docs/phase3-contract.md:

- [Carpooling and the real-time layer (module 2)](docs/carpool.md)
- [Notes marketplace (module 3)](docs/marketplace.md)
- [Alumni network (module 6)](docs/alumni.md)
