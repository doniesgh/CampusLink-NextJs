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
`middleware/optionalAuth.js` sets `req.user` when a valid token is present and continues anonymously otherwise.

### User model — `models/userModel.js`

Fields added in phase 1: `locale` (`'fr' | 'en'`, default `'fr'`), `group` (ObjectId → Group, students only),
`calendarToken` (`select: false`, unique when set; clear it with `$unset`, not `null`).

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
resource: `{ groups?, users?, sessions?, announcements? }`. Sessions are counted through
`mongoose.models.ClassSession` (`subject`, `room`, `groups` fields) and announcements through
`mongoose.models.Announcement` (`audience.programs`, `audience.groups`) when those models are registered.

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
- Files live under `STORAGE_DIR` (default `backend/uploads`, git-ignored) with generated names; store the `key`
  and the original `filename` in your model. Keys are validated (no path traversal).

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
`currentAcademicYear()` (`'2026-2027'`, starts in September). All take an optional timezone last.

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
