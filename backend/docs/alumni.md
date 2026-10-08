# Alumni directory and network — `/api/alumni` (Module 6)

Phase 3 contract, section 4 ([`docs/phase3-contract.md`](../../docs/phase3-contract.md)). Alumni profiles with GDPR
consent, a campus directory, mentoring requests between students and alumni (contact shared only after acceptance),
a news wall with moderation, and the data export / erasure of an alumni.

Code: `models/{alumniProfile,mentoringRequest,alumniPost}Model.js`, `service/alumniService.js` (rules, visibility,
consent, limits, notifications, export and erasure), `controllers/alumniController.js` (HTTP parsing, validation,
audit), `routes/alumni.js`, seed `scripts/seed/80-alumni.js`.

Every route needs `Authorization: Bearer` (`401 AUTH_REQUIRED` / `TOKEN_EXPIRED` / `INVALID_TOKEN`). Ids in the path
are checked (`400 INVALID_ID`); unknown or invisible content → `404 RESOURCE_NOT_FOUND`; a role that may not call a
route → `403 FORBIDDEN`. Errors keep the usual shape `{ error, code, details? }`; invalid fields are all reported at
once in `details` (`400 VALIDATION_ERROR`). Unknown body fields are ignored (no mass assignment of `user`,
`consentAt`, `author`, `hidden`, `status`...). Malformed JSON → `400 INVALID_JSON`.

## Endpoints

| Endpoint | Who | Answer |
| -------- | --- | ------ |
| `GET /me` | ALUMNI | AlumniProfile (`id: null`, `PRIVATE` until saved once; a read creates nothing) |
| `PUT /me` | ALUMNI | `200` AlumniProfile (creates or updates; only the fields sent change) |
| `GET /me/export` | ALUMNI | JSON file of everything stored about the caller (audited `alumni.export`) |
| `DELETE /me` | ALUMNI | `204`: profile and posts deleted, mentoring history anonymized (audited `alumni.erase`) |
| `GET /?q&program&promotion&sector&skill&mentoring&sort&page&limit` | any | `{ items: [AlumniProfile], total, page, limit }`, listed profiles only |
| `GET /facets` | any | `{ total, mentoringAvailable, programs, promotions, sectors, skills }` of the directory (extra, for filters) |
| `GET /:id` | any | AlumniProfile + `myRequest`; `:id` = profile id **or** the alumni's user id |
| `POST /:id/mentoring` `{ topic, message }` | STUDENT | `201` MentoringRequest |
| `GET /mentoring?role=mentor\|mentee&status&page&limit` | any | `{ items, total, page, limit, role, pendingCount }` (own requests) |
| `GET /mentoring/:id` | mentor, mentee, ADMIN | MentoringRequest |
| `POST /mentoring/:id/accept` `{ reply? }` | the mentor | `200` MentoringRequest `ACCEPTED` |
| `POST /mentoring/:id/decline` `{ reply? }` | the mentor | `200` MentoringRequest `DECLINED` |
| `POST /mentoring/:id/close` | mentor or mentee | `200` MentoringRequest `CLOSED` |
| `GET /posts?type&author&hidden&page&limit` | any | `{ items: [AlumniPost], total, page, limit }`, newest first |
| `POST /posts` `{ type, body, link? }` | ALUMNI | `201` AlumniPost (10 per day) |
| `DELETE /posts/:id` | author, ADMIN | `204` (audited `alumni.post.delete` when an ADMIN deletes someone else's post) |
| `POST /posts/:id/hide` `{ reason? }` | ADMIN | `200` AlumniPost (idempotent, audited `alumni.post.hide` once) |
| `POST /posts/:id/unhide` | ADMIN | `200` AlumniPost (idempotent, audited `alumni.post.unhide` once) |
| `GET /admin/profiles?q&visibility&mentoring&page&limit` | ADMIN | every profile (PRIVATE too) + `listed`, most recently updated first |

Fixed paths (`/me`, `/facets`, `/mentoring`, `/posts`, `/admin/...`) are matched before `/:id`.

## JSON

```
AlumniProfile { id, user: { id, firstname, lastname }, program: { id, name, code } | null, promotion, headline, bio,
                skills: [string], company, jobTitle, sector, city, linkedinUrl, mentoringAvailable,
                mentoringTopics: [string], visibility: "PRIVATE" | "CAMPUS", consentAt, updatedAt }
  GET /:id adds   myRequest: { id, status } | null   (STUDENT viewer: their open request to this alumni, else their
                                                      latest one; null for other roles)
  admin list adds listed: boolean                    (CAMPUS + consent + the account is still an ALUMNI)

MentoringRequest { id, mentor: { id, firstname, lastname, profileId } | null, mentee: { id, firstname, lastname } | null,
                   topic, message, reply, status: "PENDING" | "ACCEPTED" | "DECLINED" | "CLOSED",
                   contact: { mentorEmail, menteeEmail } | null, createdAt, updatedAt, respondedAt, closedAt,
                   closedBy: "MENTOR" | "MENTEE" | "SYSTEM" | null }

AlumniPost { id, type: "NEW_JOB" | "ACHIEVEMENT" | "OPPORTUNITY" | "EVENT" | "OTHER", body, link,
             author: { id, firstname, lastname, profileId, headline } | null, hidden, hiddenAt, hiddenReason,
             createdAt, updatedAt }
```

- Optional texts are `null` when empty (`headline`, `bio`, `company`, `jobTitle`, `sector`, `city`, `linkedinUrl`,
  `promotion`, `program`, `reply`, `link`). Texts are plain text (line breaks kept): clients never render HTML.
- **E-mail addresses are never part of a profile, a post or a list item.** The only place they appear is `contact`
  of a request, for its two participants, while it is `ACCEPTED` (closed requests hide it again; ADMINs never get it).
- `mentor.profileId` / `author.profileId` + `author.headline`: the profile id when the viewer may open that profile
  (listed, or own, or ADMIN), else `null` (e.g. an author whose profile is PRIVATE).
- `mentor` / `mentee` is `null` once that person erased their alumni data or their account was deleted by an admin
  (the deletion runs the same erasure).
- `hiddenAt` / `hiddenReason` are only filled on hidden posts, which only ADMINs and their author receive.

## Profiles and consent (GDPR)

- A profile belongs to one ALUMNI account (unique). `PUT /me` fields, all optional (`""` or `null` clears a text):
  `program` (existing Program id or null), `promotion` (graduation year, integer 1950 … next year), `headline` ≤ 120,
  `bio` ≤ 2000 (multi-line), `skills` ≤ 20 items of 1–40 characters, `company` ≤ 120, `jobTitle` ≤ 120, `sector` ≤ 80
  (free text, e.g. "Data & AI"), `city` ≤ 80, `linkedinUrl` (`https://` URL on `linkedin.com` or a subdomain, ≤ 300,
  no credentials), `mentoringAvailable` (boolean), `mentoringTopics` ≤ 10 items of 2–60 characters, `visibility`
  (`PRIVATE` | `CAMPUS`), `consent` (boolean). One-line fields collapse whitespace; lists are de-duplicated ignoring
  case and accents (first spelling kept). A body without any known field → `400 NO_CHANGES`.
- **Consent rules** (`400 VALIDATION_ERROR` with `details.consent` when broken):
  - a new profile is `PRIVATE` with `consentAt: null`;
  - `CAMPUS` needs an explicit consent: send `{ visibility: "CAMPUS", consent: true }`; the server sets `consentAt`
    (client values are ignored). Later updates keep it while the profile stays `CAMPUS`;
  - `visibility: "PRIVATE"` or `consent: false` withdraws the consent (`consentAt: null`, profile `PRIVATE`);
    going back to `CAMPUS` needs `consent: true` again; `{ visibility: "CAMPUS", consent: false }` is refused.
- **Visibility**: other users (any role) only see profiles with `visibility: CAMPUS`, a `consentAt`, and an owner whose
  role is still `ALUMNI` (an account moved to another role or deleted disappears from the directory). The owner and
  ADMINs (support) always see it; everyone else gets `404`.

## Directory

- `GET /api/alumni` lists the visible profiles. Filters (each a single value, else `400 VALIDATION_ERROR`):
  `program` (id), `promotion` (year), `sector` and `skill` (exact match ignoring case, accents and extra spaces:
  `?sector=data%20%26%20ai`), `mentoring=true|false`, `q` (≤ 100 characters: every word must appear, ignoring case
  and accents, in the first name, last name, headline, company, job title, sector, city, skills or mentoring topics;
  regex characters are literal). `sort=name` (default: last name, first name, accent-insensitive), `recent` (last
  updated first) or `promotion` (newest first). Pagination `page`, `limit` (≤ 100).
- `GET /api/alumni/facets` (extra, for filter UIs) over the same visible profiles:
  `{ total, mentoringAvailable, programs: [{ id, name, code, count }], promotions: [{ value, count }] (newest first),
  sectors: [{ value, count }], skills: [{ value, count }] (top 30) }`.

## Mentoring

- `POST /api/alumni/:id/mentoring` (STUDENT only; other roles `403`) `{ topic (2–120, one line), message (20–1000) }`:
  - the profile must be visible to the student (`404`) and have `mentoringAvailable` (`409 MENTORING_UNAVAILABLE`);
  - **one PENDING request per (student, alumni) pair** → `409 ALREADY_REQUESTED`;
  - **at most 3 PENDING requests per student** → `409 MENTORING_LIMIT_REACHED`, `details: { limit: 3, current }`;
  - at most `RATE_LIMIT_MENTORING_MAX` (10) requests per `RATE_LIMIT_MENTORING_WINDOW_MS` (24 h) per student (refused
    ones count too) → `429 TOO_MANY_REQUESTS`, so a request / withdraw loop cannot flood an alumni.
- Only the mentor accepts or declines a `PENDING` request, with an optional `reply` (≤ 1000). The mentee or an ADMIN
  → `403`; anybody else → `404`; not PENDING → `409 INVALID_STATE` (`details.status`).
- Either participant closes a `PENDING` (withdraw) or `ACCEPTED` (end of the mentoring) request; `DECLINED` / `CLOSED`
  → `409 INVALID_STATE`; ADMIN → `403`. Leaving `PENDING` frees a slot of the student's limit.
- `GET /mentoring`: `role` defaults to `mentor` for ALUMNI and `mentee` for everyone else; `status` takes one value
  or a comma list (`PENDING,ACCEPTED`); newest first; `pendingCount` = PENDING requests of that role (badge).

### Notifications (`type: "MENTORING"`, recipient's locale, in-app + push, never an e-mail address)

| When | Who | Title (fr / en) | `data.kind` | Link |
| ---- | --- | --------------- | ----------- | ---- |
| New request | mentor | `Nouvelle demande de mentorat de <name>` / `New mentoring request from <name>` | `REQUEST` | `/dashboard/alumni/me#mentoring` |
| Accepted | mentee | `<name> a accepté ta demande de mentorat` / `<name> accepted your mentoring request` | `ACCEPTED` | `/dashboard/alumni#mentoring` |
| Declined | mentee | `<name> ne peut pas accepter ta demande de mentorat` / `<name> declined your mentoring request` | `DECLINED` | `/dashboard/alumni#mentoring` |
| Closed | the other side | `<name> a clôturé la demande de mentorat` / `<name> closed the mentoring request` | `CLOSED` | the other side's page |
| Erased | the other side of an open request | `Demande de mentorat clôturée` / `Mentoring request closed` | `ERASED` | the other side's page |

Body: the topic (or the mentor's reply). `data.requestId` is always set; `tag` = `mentoring-<requestId>`.

## News wall

- Any signed-in user reads `GET /posts` (`type` filter, `author` = a user id or `me`). Hidden posts are returned only to
  ADMINs (all, or `hidden=true|false` to filter) and to their author (with `hiddenReason`).
- `POST /posts` (ALUMNI only): `type` (case-insensitive), `body` 10–2000 (plain text), optional `link` (`https://` URL,
  ≤ 500, no credentials). **10 posts per day per alumni**: `RATE_LIMIT_ALUMNI_POST_MAX` (10) per
  `RATE_LIMIT_ALUMNI_POST_WINDOW_MS` (24 h) → `429 TOO_MANY_REQUESTS` with `Retry-After` / `details.retryAfter`.
- `DELETE /posts/:id`: author or ADMIN (`403` for other users who can see it, `404` for a hidden one).
- Moderation (ADMIN): `hide` with an optional `reason` (≤ 500, shown to the author), `unhide`; both idempotent.
- Audit: `alumni.post.delete` (ADMIN deleting another user's post), `alumni.post.hide`, `alumni.post.unhide`
  (`targetType: "AlumniPost"`, `metadata: { authorId, type }` plus `reason` for a hide with a reason and `hidden` for
  a delete). The author deleting their own post is not audited.

## GDPR: export and erasure

- `GET /me/export` → `200` JSON with `Content-Disposition: attachment; filename="campuslink-alumni-data-<date>.json"`
  and `Cache-Control: no-store`:
  `{ exportedAt, user: { id, firstname, lastname, email, role, locale, createdAt }, profile (+ createdAt) | null,
  posts: [AlumniPost] (hidden ones too), mentoring: { asMentor: [MentoringRequest], asMentee: [MentoringRequest] } }`
  (contact e-mails only on ACCEPTED requests, as in the app). Audited `alumni.export` (`targetType: "User"`,
  `metadata: { profile, posts, asMentor, asMentee }`).
- `DELETE /me` → `204` (idempotent). In this order: deletes the profile, deletes every post of the account, then, in one
  atomic update per request, closes its open requests (`CLOSED`, `closedBy: "SYSTEM"`) and anonymizes its side of the
  whole mentoring history (as mentor: id, names and `reply` removed; as mentee: id, names and `message` removed);
  deletes the account's own `MENTORING` notifications; notifies the other side of each request that was still open
  (`ERASED`). The account itself stays (deleting accounts is the admin's `DELETE /api/users/:id`). Audited
  `alumni.erase` (`metadata: { profileId, profile, posts, mentoringAsMentor, mentoringAsMentee }`). Notifications
  that other users already received keep the alumni's name until they expire (90 days).
- `alumniService.purgeUser(userId)` runs the same erasure without its own audit entry and never throws. The account
  deletion (`DELETE /api/users/:id`, audited `user.delete`) calls it for every role, after the account is deleted:
  the right to be forgotten also applies when an admin deletes the account (alumni profile and posts deleted,
  mentoring history anonymized on both sides: a deleted student's requests lose their name and message too).

## Concurrency (no transactions)

- **Pending limit**: every PENDING request holds a numbered `pendingSlot` (1..3); a unique partial index
  `(mentee, pendingSlot)` on PENDING requests makes a 4th concurrent request fail (duplicate key → next slot → `409
  MENTORING_LIMIT_REACHED`). Leaving PENDING drops the request out of the partial index (slot freed).
- **One pending request per pair**: unique partial index `(mentee, mentor)` on PENDING requests → `409
  ALREADY_REQUESTED`, also for simultaneous requests.
- **Accept / decline / close**: compare-and-set (`findOneAndUpdate` on `status`): concurrent answers → exactly one
  wins, the others get `409 INVALID_STATE`.
- **Erasure vs a new request**: the erasure deletes the profile before anonymizing the requests, and a new request
  checks again after its insert that the profile still exists (else it deletes itself and answers `404`): no request is
  ever left on an erased mentor.
- **Profile creation**: unique `user` index; two simultaneous first `PUT /me` both succeed on one profile.
- **Posts**: hide / unhide are conditional updates (audited only by the request that changed the state); concurrent
  deletions → one `204`, the others `404`.

## Models (names are part of the contract)

| Model | Collection | Notes |
| ----- | ---------- | ----- |
| `AlumniProfile` | `alumniprofiles` | unique `user`; hidden search keys `sectorKey`, `skillKeys` (lowercase, no accents) |
| `MentoringRequest` | `mentoringrequests` | `mentor`, `mentee` (null once erased), name snapshots, `pendingSlot`, unique partial indexes above |
| `AlumniPost` | `alumniposts` | `author` + name snapshot, moderation fields |

## Rate limits (in memory, per instance; `RATE_LIMIT_ENABLED=false` disables them)

| Route | Variable (default) | Window variable (default) |
| ----- | ------------------ | ------------------------- |
| `POST /api/alumni/posts` | `RATE_LIMIT_ALUMNI_POST_MAX` (10) | `RATE_LIMIT_ALUMNI_POST_WINDOW_MS` (86400000) |
| `POST /api/alumni/:id/mentoring` | `RATE_LIMIT_MENTORING_MAX` (10) | `RATE_LIMIT_MENTORING_WINDOW_MS` (86400000) |

## Demo data (`scripts/seed/80-alumni.js`)

8 alumni accounts (password `Campus123!`): `selim.rekik@` (core), `rania.gharsalli@`, `walid.mejdoub@`, `emna.chebbi@`
(en), `firas.guesmi@` (mentoring not available), `hela.tlili@`, `mouna.kacem@` (en) — 7 listed profiles in
7 sectors (Software, Data & AI, Cloud & DevOps, Fintech, Cybersecurity, Telecom, E-health) — and `bilel.saidi@` with a
PRIVATE profile. Mentoring requests from demo students in every state: 3 PENDING (Yasmine → Rania and Walid, Ines →
Mouna), 2 ACCEPTED (Omar → Selim, Aya → Hela), 1 DECLINED (Sarra → Firas), 2 CLOSED (by the mentor, by the mentee).
9 posts of every type, one hidden by the moderation team. Companies and links are fictitious (`example.com`).
Idempotent (profiles, posts and requests of these accounts are recreated); sends no notification.

## Limits and integration notes

- `DELETE /api/users/:id` cascades to this module through `alumniService.purgeUser` (same erasure as `DELETE
  /api/alumni/me`): nothing of a deleted account stays on the news wall, in the directory or in the mentoring
  history. The purge runs after the account deletion and never fails it: if it fails (database error, logged as
  `[alumni] Could not purge…`), an admin can rerun it from a shell (`alumniService.purgeUser(id)`, idempotent).
- The directory search uses regular expressions on a `$lookup` of the owners (no text index): fine for a campus
  (thousands of profiles), not designed for millions.
