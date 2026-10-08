# Bookings module — `/api/resources`, `/api/bookings` (Module 5)

Room and equipment booking, phase 2 contract section 1 ([`docs/phase2-contract.md`](../../docs/phase2-contract.md)).
Everything in the phase 1 conventions still applies: `{ error, code, details? }` errors, string `id`, ISO 8601 UTC
dates, `{ items, total, page, limit }` pagination, campus timezone `APP_TIMEZONE` (default `Africa/Tunis`).

| File | Role |
| ---- | ---- |
| `models/equipmentModel.js` | `Equipment` |
| `models/bookingModel.js` | `Booking` (+ `serializeBooking`, `BOOKING_POPULATE`) |
| `models/bookingSlotModel.js` | `BookingSlot` (15-minute slot claims, unique `(resourceKey, slot)`) |
| `models/roomModel.js` | two new Room fields: `bookable`, `requiresApproval` |
| `service/bookingService.js` | rules, conflicts, slot and seat claims, status changes, notifications, jobs, availability, free rooms, statistics |
| `controllers/resourceController.js`, `routes/resources.js` | equipment CRUD |
| `controllers/bookingController.js`, `routes/bookings.js` | booking endpoints |
| `scripts/seed/30-bookings.js` | demo equipment and bookings |

## Resources

### Rooms (`/api/academic/rooms`, unchanged routes)

Room JSON gains two fields: `{ id, name, building, capacity, type, bookable, requiresApproval }`.

- `bookable` (boolean, default `true`): only bookable rooms can be booked and appear in the free-room finder.
- `requiresApproval` (boolean): default `true` for an `AMPHITHEATER`, `false` otherwise (applied when the room is
  created, including through an upsert; rooms stored before phase 2 read as these defaults). Changing the type later
  does not change it.
- `POST` / `PATCH /api/academic/rooms[/:id]` accept both (booleans only, else `400 VALIDATION_ERROR` with
  `details.bookable` / `details.requiresApproval`); changes are audited as `academic.room.update` like the other fields.

### Equipment — `/api/resources/equipment`

Equipment JSON: `{ id, name, category, location, description, requiresApproval, active }`,
`category` ∈ `PROJECTOR`, `LAPTOP`, `CAMERA`, `AUDIO`, `LAB_KIT`, `OTHER`.

| Endpoint | Who | Answer |
| -------- | --- | ------ |
| `GET /equipment?category&active` | any | `[Equipment]` sorted by name. `category`: one value or a comma list; `active`: `true` / `false` (absent = all) |
| `GET /equipment/:id` | any | Equipment |
| `POST /equipment` | ADMIN | `201` Equipment |
| `PATCH /equipment/:id` | ADMIN | `200` Equipment (`400 NO_CHANGES` for an empty body) |
| `DELETE /equipment/:id` | ADMIN | `204`, or `409 IN_USE` with `details.references.bookings` while future PENDING / CONFIRMED bookings exist |

- Body: `name` (1–100, unique ignoring case → `409 ALREADY_EXISTS`, `details.field: "name"`), `category` (default
  `OTHER`), `location` (≤ 200), `description` (≤ 1000), `requiresApproval` (boolean, default `false`), `active`
  (boolean, default `true`). Invalid fields → `400 VALIDATION_ERROR` with `details.<field>`.
- Inactive equipment stays listed (history) but cannot be booked. Clients usually list `?active=true`.
- Audited `equipment.create|update|delete` (update metadata lists the changed fields with before / after values).
- Past bookings keep the name of a deleted item (snapshot).

## Bookings — `/api/bookings` (all routes need a token)

Booking JSON:

```json
{
  "id": "…", "resourceType": "ROOM",
  "room": { "id": "…", "name": "Amphi A", "building": "Bloc A", "capacity": 200, "type": "AMPHITHEATER" },
  "equipment": null,
  "user": { "id": "…", "firstname": "Yasmine", "lastname": "Haddad", "role": "STUDENT" },
  "purpose": "Répétition générale du club théâtre",
  "startsAt": "2026-10-10T16:00:00.000Z", "endsAt": "2026-10-10T18:00:00.000Z",
  "status": "PENDING",
  "decision": null,
  "cancelledAt": null, "cancelledBy": null,
  "version": 0, "createdAt": "…", "updatedAt": "…"
}
```

- `equipment` is `{ id, name, category }` for an `EQUIPMENT` booking (then `room` is `null`).
- `decision` = `{ by: { id, firstname, lastname }, at, note }` after an approval or a rejection.
- `cancelledAt` / `cancelledBy` (`"OWNER"` | `"ADMIN"`) are set on cancelled bookings (additions to the contract shape).
- `version` increases on every status change (optimistic locking, see below).
- Names of a deleted room, item, user or admin come from snapshots taken when the booking was made / decided.

| Endpoint | Who | Answer |
| -------- | --- | ------ |
| `GET /availability?resourceType&resource&from&to` | any | `{ resourceType, resource, bookable, requiresApproval, from, to, busy }` |
| `GET /free-rooms?from&to&minCapacity&type` | any | `[Room]` free for the whole interval |
| `POST /` | STUDENT, TEACHER, ADMIN | `201` Booking (ALUMNI → `403 FORBIDDEN`) |
| `GET /me?status&scope=upcoming\|past&page&limit` | any | own bookings, paginated |
| `GET /:id` | owner, ADMIN | Booking (others → `404 RESOURCE_NOT_FOUND`) |
| `POST /:id/cancel` `{ version }` | owner before the start, ADMIN any time | `200` Booking `CANCELLED` |
| `GET /?status&resourceType&resource&user&from&to&order&page&limit` | ADMIN | every booking, paginated |
| `POST /:id/approve` `{ version, note? }` | ADMIN | `200` Booking `CONFIRMED` |
| `POST /:id/reject` `{ version, note }` | ADMIN | `200` Booking `REJECTED` |
| `GET /stats?from&to` | ADMIN | usage statistics |

### Rate limits

Every PENDING request notifies the admins, and cancelling frees the slot and the student's seat, so a create /
cancel loop could flood the admins. Both routes have a per-user limit (`middleware/rateLimit.js`,
`userRateLimit`, in memory per instance, key = action + user id, skipped with `RATE_LIMIT_ENABLED=false`), counted on
every request that passes the role check (also refused ones):

| Route | Limit per `RATE_LIMIT_BOOKING_WINDOW_MS` (default 1 h) | Who |
| ----- | ------------------------------------------------------ | --- |
| `POST /api/bookings` | `RATE_LIMIT_BOOKING_CREATE_MAX` (30) | STUDENT, TEACHER, ADMIN |
| `POST /api/bookings/:id/cancel` | `RATE_LIMIT_BOOKING_CANCEL_MAX` (30) | STUDENT, TEACHER (ADMIN cancellations are not limited: moderation, audited) |

Over the limit → `429 TOO_MANY_REQUESTS` with a `Retry-After` header and `details.retryAfter` (seconds), plus the
`RateLimit` / `RateLimit-Policy` headers (draft 7).

### Creating a booking

`POST /api/bookings` `{ resourceType: "ROOM" | "EQUIPMENT", room | equipment: id, startsAt, endsAt, purpose }`.

- `startsAt` / `endsAt`: ISO 8601 with `Z` or an offset (`2026-10-14T15:00:00.000Z`), or campus wall-clock time
  `YYYY-MM-DDTHH:mm` (`2026-10-14T17:00`). A date alone is refused.
- `purpose`: 2–300 characters, plain text. Only the field of the chosen type may be set (`room` for ROOM, else
  `details.room` / `details.equipment`).
- Unknown resource → `400 VALIDATION_ERROR` (`details.room: "Unknown room"` / `details.equipment`).
- Status: `PENDING` when the room / item `requiresApproval`, else `CONFIRMED` (same rule for every role, admins
  included: an admin can then approve their own request).

**Rules** — a broken rule answers `400 VALIDATION_ERROR` with `details = { <field>: "<English message>", rule, … }`
(the first broken rule only), so clients can translate `details.rule`:

| `rule` | Field | Meaning |
| ------ | ----- | ------- |
| `NOT_BOOKABLE` | `room` | room with `bookable: false` |
| `INACTIVE` | `equipment` | equipment with `active: false` |
| `END_BEFORE_START` | `endsAt` | `endsAt` ≤ `startsAt` |
| `TIME_GRID` | `startsAt` / `endsAt` | not on the 15-minute grid (`:00`, `:15`, `:30`, `:45`, no seconds) |
| `SAME_DAY` | `endsAt` | ends on another campus day |
| `OPENING_HOURS` | `startsAt` / `endsAt` | outside 07:00–21:00 campus time (an end at 21:00 is allowed) |
| `IN_PAST` | `startsAt` | does not start in the future |
| `TOO_FAR_AHEAD` | `startsAt` | starts more than 60 days from now (`details.maxDaysAhead: 60`) |
| `MAX_DURATION` | `endsAt` | longer than 3 h (STUDENT) or 8 h (TEACHER, ADMIN) (`details.maxHours`) |

Then, in this order:

- **Student limit**: a STUDENT holds at most 3 upcoming (not yet ended) PENDING / CONFIRMED bookings →
  `409 BOOKING_LIMIT_REACHED`, `details: { limit: 3, current }`.
- **Conflicts**: a PENDING / CONFIRMED booking of the same resource, or (rooms) a `SCHEDULED` class session in the
  room, overlapping `[startsAt, endsAt)` → `409 BOOKING_CONFLICT`, `details.conflicts` sorted by start:
  - everyone: `{ kind: "BOOKING" | "CLASS", startsAt, endsAt }`, plus `mine: true|false` on bookings (the
    requester's own booking). **No other user's identity, purpose or id for non-admins.**
  - ADMIN also gets `bookingId`, `status`, `purpose`, `user: { id, firstname, lastname, role }` (bookings) and
    `sessionId`, `subject: { id, name, code }` (classes).
  - Back-to-back bookings (one ends at 18:00, the next starts at 18:00) do not conflict. Cancelled class sessions
    never block.

### Concurrency (no transactions)

- **Slots.** Every PENDING / CONFIRMED booking holds one `BookingSlot` per 15 minutes it covers:
  `{ resourceKey: "ROOM:<id>" | "EQUIPMENT:<id>", slot: <start of the quarter hour>, booking, createdAt }`, unique
  index `(resourceKey, slot)`. A booking first checks conflicts by reading (to report every conflict, classes
  included), then claims its slots with an ordered `insertMany`; a duplicate-key error means another booking won:
  the slots claimed by the request are released and the answer is `409 BOOKING_CONFLICT`. Then the `Booking`
  document is written (same `_id` as the claims). Slots are released when a booking is rejected or cancelled.
- **Seats (student limit).** The limit uses the same unique index: each upcoming PENDING / CONFIRMED booking of a
  STUDENT also holds one of 3 seat rows `{ resourceKey: "STUDENT:<userId>", slot: <fixed date in year 9999 + n × 15
  min>, booking }`. Simultaneous requests of one student never exceed 3 and the first ones win. A seat is released
  with the booking's slots, and lazily once its booking has ended (when the student needs a new seat). After the
  insert, a count check rolls back a booking that would exceed the limit anyway (safety net).
- **Stale claims.** If a claim collides with slots whose booking is no longer active (release failed) or never got
  written (request interrupted, claim older than 2 minutes), those slots are deleted and the claim is retried once.
  The job `bookings.release-stale-slots` (every 10 minutes) also deletes future slots of inactive or missing bookings.
- Past slots are deleted by MongoDB 30 days after their time (TTL index on `slot`).

### Status changes (optimistic locking)

`approve`, `reject` and `cancel` take the `version` the client read (`400 VALIDATION_ERROR`, `details.version`, when
missing). The change is a single `findOneAndUpdate({ _id, version, status ∈ allowed })` that also increments
`version`; when it matches nothing:

- stale `version` → `409 VERSION_CONFLICT`, `details: { version, status }` (current values: reload and retry) — e.g.
  two admins deciding at once: one wins, the other gets this error;
- right version but wrong status → `409 INVALID_STATE`, `details.status` (e.g. approving a CONFIRMED booking).

| Action | From | Extra rules |
| ------ | ---- | ----------- |
| approve | PENDING | not when the booking has already ended (`409 INVALID_STATE`, `details.reason: "ENDED"`); `note` optional (≤ 500) |
| reject | PENDING | `note` required (1–500); releases the slots |
| cancel | PENDING, CONFIRMED | owner: before the start (`409 INVALID_STATE`, `details.reason: "STARTED"`); ADMIN: any time; someone else → `404`; releases the slots |

Audited: `booking.approve`, `booking.reject`, `booking.cancel` (every cancellation; `metadata.byOwner`), with the
resource, times, owner, status, version and note.

### Notifications (type `BOOKING`, in-app + push, recipient's locale)

| When | Who | Example (fr / en) | Link |
| ---- | --- | ----------------- | ---- |
| a PENDING request is created (coalesced, see below) | every ADMIN except the requester | « Nouvelle demande de réservation : Amphi A (sam. 10 oct., 17:00–19:00) » / "New booking request: Amphi A (Sat, Oct 10, 17:00–19:00)" | `/dashboard/admin/bookings?booking=<id>` |
| approved | requester | « Réservation confirmée : … » + « Bonne nouvelle : ta demande a été acceptée. Note : … » / "Booking confirmed: …" | `/dashboard/bookings?booking=<id>` |
| rejected | requester | « Réservation refusée : … » + « Motif : … » / "Booking rejected: …" + "Reason: …" | same |
| cancelled by an admin | owner | « Réservation annulée : … » / "Booking cancelled: …" | same |
| reminder | owner | « Rappel : Amphi A à 17:00 (sam. 10 oct.) » / "Reminder: Amphi A at 17:00 (Sat, Oct 10)" | same |

`data = { bookingId, status, resourceType, resourceId, startsAt, endsAt, kind }` with `kind` ∈ `REQUEST`, `CONFIRMED`,
`REJECTED`, `CANCELLED`, `REMINDER`. Nobody is notified about their own action (owner cancelling, admin approving
their own request).

**Request notifications are coalesced per requester**: the admins get at most one "new request" notification per
requester every 10 minutes (`REQUEST_NOTIFY_COOLDOWN_MS`); the other requests of that window are not notified and
wait in the pending queue of `/dashboard/admin/bookings`. The push tag is `booking-request-<requesterId>`, so a new
push replaces the previous one on the admins' devices. The notified booking keeps an internal `requestNotifiedAt`
(not serialized). Best effort: two simultaneous requests of one requester may both notify (the rate limit bounds it).

**Reminders**: the job `bookings.reminders` (every `SCHEDULER_INTERVAL_MS`) notifies the owner of each CONFIRMED
booking starting within `BOOKING_REMINDER_MINUTES` (default 60), once: each booking is claimed with
`findOneAndUpdate({ status: "CONFIRMED", reminderSentAt: null, startsAt in (now, now + N min] })`, so several backend
instances never send it twice. A booking approved inside that window gets its reminder on the next run.

### Reading

- **`GET /availability`** (`resourceType` and `resource` required → `400 MISSING_FIELDS`; unknown resource → `404`).
  `from` / `to` like the timetable: `YYYY-MM-DD` (00:00 campus time), campus wall-clock or ISO; default the current
  week (Monday → next Monday); only `from` → 7 days; more than 31 days → `400 RANGE_TOO_LARGE`. `busy` (sorted) lists
  PENDING / CONFIRMED bookings and, for rooms, SCHEDULED class sessions:
  - booking: `{ startsAt, endsAt, kind: "BOOKING", label, status, mine }`; `label` is `"Booked"` for someone else's
    booking, the purpose for one's own (with `bookingId`); ADMIN: `label` = "Firstname Lastname · purpose", plus
    `bookingId`, `purpose`, `user`.
  - class: `{ startsAt, endsAt, kind: "CLASS", label: "Class" }`; ADMIN: label "Subject (groups)", `sessionId`, `subject`.
  - `label` values for non-admins are fixed English words: clients translate from `kind`.
- **`GET /free-rooms`** (`from` and `to` required → `400 MISSING_FIELDS`, ≤ 31 days): bookable rooms with no PENDING /
  CONFIRMED booking and no SCHEDULED class overlapping the interval, sorted by name. `minCapacity` (integer ≥ 1;
  rooms without capacity are left out) and `type` (`CLASSROOM`, `AMPHITHEATER`, `LAB`, `OTHER`) are optional.
  Rooms that need an approval are included (`requiresApproval: true`).
- **`GET /me`**: own bookings. `scope=upcoming` → not ended yet, by start ascending; `scope=past` → ended, newest
  first; no scope → all, newest start first. `status` = one value or a comma list.
- **`GET /`** (ADMIN): filters `status` (comma list), `resourceType`, `resource` (room or equipment id), `user`,
  `from` / `to` (bookings overlapping the range), `order=asc|desc` on `startsAt` (default `asc`).

### Statistics — `GET /api/bookings/stats?from&to` (ADMIN)

Default range: the current month (campus time); at most 366 days (`400 RANGE_TOO_LARGE`).

```json
{ "from": "…", "to": "…",
  "totals": { "byStatus": { "PENDING": 3, "CONFIRMED": 30, "REJECTED": 3, "CANCELLED": 5 },
              "bookings": 41, "bookedHours": 53, "openingHours": 378 },
  "resources": [ { "resourceType": "ROOM", "id": "…", "name": "C202", "bookings": 6, "bookedHours": 16,
                   "occupancyRate": 0.0423 } ] }
```

- `byStatus`: bookings overlapping the range, per status (every status present, 0 included).
- `resources`: every bookable room and active item, plus anything booked in the range; `bookings` / `bookedHours` =
  CONFIRMED bookings and their hours inside the range; `occupancyRate` = booked hours / opening hours of the range
  (Monday–Saturday 07:00–21:00 campus time, `openingHours`), between 0 and 1 (4 decimals). Sorted by occupancy, then
  booked hours, then name.

## Error codes of the module

`VALIDATION_ERROR` (400, `details`), `MISSING_FIELDS` (400), `INVALID_ID` (400), `RANGE_TOO_LARGE` (400),
`NO_CHANGES` (400), `AUTH_REQUIRED` / `TOKEN_EXPIRED` / `INVALID_TOKEN` (401), `FORBIDDEN` (403),
`RESOURCE_NOT_FOUND` (404), `ALREADY_EXISTS` (409), `IN_USE` (409), `BOOKING_CONFLICT` (409),
`BOOKING_LIMIT_REACHED` (409), `VERSION_CONFLICT` (409), `INVALID_STATE` (409), `TOO_MANY_REQUESTS` (429).

## Configuration

`BOOKING_REMINDER_MINUTES` (default 60), `SCHEDULER_INTERVAL_MS` (reminder job interval), `APP_TIMEZONE`,
`RATE_LIMIT_BOOKING_CREATE_MAX` (30), `RATE_LIMIT_BOOKING_CANCEL_MAX` (30), `RATE_LIMIT_BOOKING_WINDOW_MS` (3600000)
and `RATE_LIMIT_ENABLED` (see "Rate limits").

## Demo data — `scripts/seed/30-bookings.js`

Idempotent: upserts 7 equipment items by name (projectors, a laptop, a camera that needs an approval, a microphone,
an Arduino kit, an inactive Raspberry Pi kit), sets the booking fields on rooms that lack them (Amphi A: approval
required), then replaces the bookings with `source: "SEED"` (and their slots / seats): upcoming ones (Yasmine's
PENDING request on Amphi A, Ines's PENDING camera request, confirmed room and projector bookings, one rejected with a
note, one cancelled) and past confirmed ones for the statistics. Rooms are booked after 16:30 or on Saturdays so they
never overlap the demo timetable; a booking that would overlap a class or a booking made by hand is skipped. No
notification is sent.

## Known limitations

- The timetable module does not check bookings: an admin can still schedule a class over a confirmed booking.
- Deleting a room in `/api/academic/rooms` is not blocked by its bookings (only by class sessions); its bookings keep
  the room's name.
- A PENDING request whose time has passed stays PENDING (it can only be rejected) and no longer counts for the limit.
