# CampusLink — Phase 2 contract

Scope: **Module 5 (room and equipment booking)**, **Module 4 (help forum by subject)** and **Module 9 (student
analytics dashboard: attendance, grades, progress, PDF report)**.

Everything in [`phase1-contract.md`](phase1-contract.md) still applies (conventions §0, error shape, auth, roles,
pagination, campus timezone `APP_TIMEZONE`, i18n FR "tu"/EN, BFF, offline data layer, file ownership rules,
Flutter-ready API). Read [`architecture.md`](architecture.md), `backend/README.md` and `next/README.md` first:
they describe the existing services (`requireAuth`/`requireRole`, `auditService.record`,
`notificationService.notifyUsers`, `pushService`, `audienceService`, `storageService` + upload middleware,
`scheduler.registerJob`, validation helpers, seed plugins) and web building blocks (`useOfflineQuery`,
`queueMutation`, BFF, UI primitives, `lib/datetime`, message namespaces). **Reuse them; do not duplicate them.**

---

## 0. Shared changes (already done by the lead before the module agents start)

- Notification `type` enum gains `BOOKING`, `FORUM`, `ATTENDANCE`, `GRADE` (labels in `messages/*/notifications.json`).
- Stub routers, already mounted in `backend/app.js`: `routes/resources.js` → `/api/resources`,
  `routes/bookings.js` → `/api/bookings`, `routes/forum.js` → `/api/forum`, `routes/attendance.js` →
  `/api/attendance`, `routes/grades.js` → `/api/grades`, `routes/analytics.js` → `/api/analytics`.
- Backend dependency `pdfkit` and web dependency `recharts` are installed (module agents never install packages).
- App shell navigation, placeholder pages and message files (`bookings`, `forum`, `analytics`) exist (§4).
- The service worker may save (owner-tagged, 24 h, see phase 1) `/dashboard/bookings`, `/dashboard/forum`,
  `/dashboard/forum/<id>` and `/dashboard/analytics`.
- New Mongoose model names (part of the contract, referenced loosely through `mongoose.models.<Name>`):
  `Equipment`, `Booking`, `BookingSlot`, `ForumQuestion`, `ForumAnswer`, `ForumVote`, `ForumProfile`,
  `AttendanceRecord`, `AttendanceAlert`, `Assessment`, `Grade`.

## 1. Module 5 — Resources and bookings

### 1.1 Resources — `/api/resources`

- Rooms stay in `/api/academic/rooms`; the Room model gains `bookable` (default `true`) and `requiresApproval`
  (default `false`, `true` for `AMPHITHEATER`) — the bookings agent adds these two fields to
  `backend/models/roomModel.js` (and to the admin academic room form) — exception to the ownership rule, keep
  the change minimal.
- Equipment JSON: `{ id, name, category, location, description, requiresApproval, active }`,
  `category` ∈ `PROJECTOR`, `LAPTOP`, `CAMERA`, `AUDIO`, `LAB_KIT`, `OTHER`, `name` unique.
- `GET /api/resources/equipment` (auth, `?category&active`), `POST|PATCH|DELETE /api/resources/equipment/:id`
  (ADMIN; DELETE → 409 `IN_USE` when future PENDING/CONFIRMED bookings exist; audited `equipment.*`).

### 1.2 Bookings — `/api/bookings`

Booking JSON:
```
{ id, resourceType: "ROOM" | "EQUIPMENT",
  room: { id, name, building, capacity, type } | null, equipment: { id, name, category } | null,
  user: { id, firstname, lastname, role }, purpose, startsAt, endsAt,
  status: "PENDING" | "CONFIRMED" | "REJECTED" | "CANCELLED",
  decision: { by: { id, firstname, lastname }, at, note } | null,
  version, createdAt, updatedAt }
```
Rules:
- Times on a 15-minute grid, same day, between 07:00 and 21:00 campus time, in the future, at most 60 days ahead.
- Max duration: STUDENT 3 h, TEACHER/ADMIN 8 h. A STUDENT has at most 3 upcoming PENDING/CONFIRMED bookings.
  ALUMNI cannot book (403 `FORBIDDEN`). Only `bookable` rooms and `active` equipment.
- **No double booking**: a PENDING or CONFIRMED booking cannot overlap another PENDING/CONFIRMED booking of the
  same resource, nor (rooms) a SCHEDULED `ClassSession` in that room → 409 `BOOKING_CONFLICT`
  `details.conflicts: [{ kind: "BOOKING" | "CLASS", startsAt, endsAt }]` (no other user's identity for
  non-admins). Concurrency-safe without transactions: each booking claims its 15-minute slots in
  `BookingSlot` (`{ resourceKey, slot, booking }`, unique index `(resourceKey, slot)`); a duplicate-key error
  means conflict and every slot already claimed by the request is released. Slots are released when a booking
  is rejected or cancelled.
- **Optimistic locking** on changes: status changes send the `version` they read; a stale version → 409
  `VERSION_CONFLICT` (e.g. two admins deciding at once).
- `requiresApproval` resource → `PENDING` and every ADMIN gets a `BOOKING` notification; otherwise `CONFIRMED`.
  Decisions notify the requester (in-app + push, localized).
- **Reminders**: a scheduler job notifies the requester `BOOKING_REMINDER_MINUTES` (default 60) before a
  CONFIRMED booking starts, once (atomic `reminderSentAt`).

Endpoints (auth):
- `GET /api/bookings/availability?resourceType&resource&from&to` (range ≤ 31 days) →
  `{ busy: [{ startsAt, endsAt, kind: "BOOKING" | "CLASS", label }] }` — `label` is "Booked"/"Class" for
  non-admins, details for admins.
- `GET /api/bookings/free-rooms?from&to&minCapacity&type` → rooms free for the whole interval.
- `POST /api/bookings` `{ resourceType, room | equipment, startsAt, endsAt, purpose }` → 201 Booking
  (400 `VALIDATION_ERROR` with `details`, 409 `BOOKING_CONFLICT`, 409 `BOOKING_LIMIT_REACHED`).
- `GET /api/bookings/me?status&scope=upcoming|past&page&limit` → own bookings.
- `POST /api/bookings/:id/cancel` `{ version }` → owner (before start) or ADMIN → 200 (`CANCELLED`).
- ADMIN: `GET /api/bookings?status&resourceType&resource&user&from&to&page&limit`,
  `POST /api/bookings/:id/approve` `{ version, note? }`, `POST /api/bookings/:id/reject` `{ version, note }`
  (409 `INVALID_STATE` unless PENDING), audited `booking.approve|reject|cancel`.
- ADMIN: `GET /api/bookings/stats?from&to` → `{ totals: { byStatus }, resources: [{ resourceType, id, name,
  bookings, bookedHours, occupancyRate }] }` (occupancy = booked hours / opening hours Mon–Sat 07:00–21:00).

## 2. Module 4 — Help forum — `/api/forum`

Question JSON: `{ id, title, body, subject: { id, name, code, color }, chapter, level, tags, author: { id,
firstname, lastname, role }, score, answerCount, acceptedAnswerId, hasCertifiedAnswer, following, myVote,
viewCount, status: "OPEN" | "CLOSED", hidden, createdAt, lastActivityAt }`.
Answer JSON: `{ id, questionId, body, author: { id, firstname, lastname, role }, certified, accepted, score,
myVote, createdAt, editedAt }`.

Rules:
- `title` 10–200, `body` 20–10000 (plain text, line breaks kept, never HTML), answer `body` 2–10000,
  `tags` ≤ 5 (lowercase, 2–30 chars), `level` 1–5 optional, `subject` required (existing Subject).
- Any authenticated user can read, ask and answer. An answer by a TEACHER is `certified`.
- Votes ±1 on questions and answers (`ForumVote`, unique per user and target; voting again with the same value
  removes the vote); no vote on one's own content (403 `FORBIDDEN`).
- The question author accepts one answer (or changes it); accepted answers are shown first.
- **Reputation** (`ForumProfile`: `{ user, reputation, answers, acceptedAnswers, bySubject: { <subjectId>:
  points }, badges: [{ code, subject?, awardedAt }] }`): +10 per upvote received on an answer, +5 on a
  question, −2 per downvote, +15 accepted answer, +2 to the author for accepting; recomputed incrementally,
  never below 0. **Badges**: `FIRST_ANSWER`, `ACTIVE_CONTRIBUTOR` (10 answers), `HELPFUL` (5 accepted answers),
  `SUBJECT_EXPERT` (50 points in one subject, per subject); awarding sends a `FORUM` notification.
- **Follow**: authors follow their questions automatically; followers (except the answerer) get a `FORUM`
  notification for each new answer; the answer author is notified when accepted.
- **Search**: MongoDB text index on title, body and tags (weights title 5, tags 3, body 1).
- **Offline answers**: `POST .../answers` accepts a `clientRequestId` (UUID); the same author + id returns the
  first answer (200) instead of creating a duplicate, so the web outbox can replay it safely.
- **Moderation**: anyone can report (`reason` 5–500); ADMIN can hide/unhide a question or answer (hidden
  content is visible only to ADMIN and its author, with a notice); authors edit their content and delete it
  while it has no answers (questions) or is not accepted (answers). Audited `forum.hide|unhide|delete`.

Endpoints (auth):
- `GET /api/forum/questions?q&subject&level&tag&status&sort=recent|votes|unanswered|activity&page&limit`.
- `GET /api/forum/questions/similar?title=` → up to 5 `{ id, title, answerCount, hasAcceptedAnswer }`.
- `POST /api/forum/questions`, `GET|PATCH|DELETE /api/forum/questions/:id` (GET increments `viewCount` once
  per user per day and returns `{ question, answers }`).
- `POST /api/forum/questions/:id/answers`, `PATCH|DELETE /api/forum/answers/:id`.
- `POST /api/forum/questions/:id/accept` `{ answerId }` (author only).
- `POST /api/forum/{questions|answers}/:id/vote` `{ value: 1 | -1 }` → `{ score, myVote }`.
- `POST|DELETE /api/forum/questions/:id/follow`.
- `POST /api/forum/{questions|answers}/:id/report` `{ reason }`; ADMIN `GET /api/forum/reports?status`,
  `POST /api/forum/{questions|answers}/:id/hide|unhide`, `POST /api/forum/reports/:id/resolve`.
- `GET /api/forum/profiles/:userId` and `/me` → ForumProfile; `GET /api/forum/leaderboard?subject&limit` (top
  reputation, current academic year).

## 3. Module 9 — Attendance, grades and analytics

### 3.1 Attendance — `/api/attendance`

AttendanceRecord: `{ id, session: { id, startsAt, endsAt, subject }, student: { id, firstname, lastname },
status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED", note, markedBy, markedAt }`, unique `(session, student)`.
- `GET /api/attendance/sessions/:sessionId` (the session's teacher or ADMIN) → `{ session, roster: [{ student,
  status | null, note }] }` — roster = students of the session's groups.
- `PUT /api/attendance/sessions/:sessionId` `{ records: [{ student, status, note? }] }` → teacher of the session
  (from 15 min before start until 7 days after end) or ADMIN (any time); not for CANCELLED sessions (409
  `INVALID_STATE`); students outside the roster → 400 `VALIDATION_ERROR`. Only ADMIN may set or remove
  `EXCUSED`. Audited `attendance.update`.
- `GET /api/attendance/me?from&to` → own records + per-subject summary.
- **Absence rate** per student and subject = unexcused ABSENT hours / hours of held (SCHEDULED, already ended)
  sessions of that subject for the student's group; LATE counts as present.
- **Alerts** (`AttendanceAlert` `{ student, subject, level: "WARNING" | "CRITICAL", rate, createdAt }`, at most one
  per level, subject and student): `WARNING` at `ABSENCE_WARNING_RATE` (default 0.10), `CRITICAL` at
  `ABSENCE_ALERT_RATE` (default 0.20); the student gets an `ATTENDANCE` notification, ADMINs see the list.
- ADMIN: `GET /api/attendance/alerts?group&level&page&limit`.

### 3.2 Grades — `/api/grades`

Assessment: `{ id, subject, group, title, type: "EXAM" | "QUIZ" | "PROJECT" | "LAB" | "OTHER", date,
maxScore (default 20), coefficient (default 1), published, createdBy }`. Grade: `{ assessment, student, score
(0..maxScore) | null, comment }`, unique `(assessment, student)`.
- TEACHER (who teaches that subject to that group this year) or ADMIN: `POST /api/grades/assessments`,
  `PATCH|DELETE /api/grades/assessments/:id`, `GET /api/grades/assessments?subject&group`,
  `GET|PUT /api/grades/assessments/:id/grades` (`{ grades: [{ student, score, comment? }] }`),
  `POST /api/grades/assessments/:id/publish` → students of the group get a `GRADE` notification.
- STUDENT: `GET /api/grades/me` → published assessments with own score, per-subject weighted average (on 20)
  and overall weighted average. Unpublished grades are never visible to students.

### 3.3 Analytics — `/api/analytics`

- `GET /api/analytics/me` (STUDENT) → `{ attendance: { overallRate, bySubject: [{ subject, heldHours,
  absentHours, rate, level }] }, grades: { overall, bySubject: [{ subject, average, assessments }],
  trend: [{ date, average }] }, activity: { weeks: [{ week, forumQuestions, forumAnswers, announcementsRead }] },
  comparison?: { … } }` — server-side aggregation; `activity` covers the last 12 weeks and reads
  `ForumQuestion`/`ForumAnswer`/`AnnouncementRead` through `mongoose.models` (0 when a model is missing).
- **Comparison** (optional, opt-in): `?compare=true` adds the group's average attendance rate and grade averages,
  only when the group has at least 5 students (else `comparison: { available: false }`); never individual data.
- `GET /api/analytics/me/report.pdf` (STUDENT) → `application/pdf` (pdfkit, A4, CampusLink header, student,
  group, academic year, attendance and grades tables, generated date), in the student's locale.
- TEACHER: `GET /api/analytics/groups/:groupId?subject` → per-student attendance rate and average for the
  subjects they teach in that group. ADMIN: same for any group, plus `GET /api/analytics/students/:id` (the
  student view of `/me`) and `GET /api/analytics/students/:id/report.pdf`.

## 4. Web app

New namespaces `bookings`, `forum`, `analytics` (FR "tu" + EN, complete). Charts with `recharts`, accessible
(text summary or table alongside each chart, colors from the design tokens, dark mode). Mobile-first.

| Path | Who | Content |
|---|---|---|
| `/dashboard/bookings` | STUDENT, TEACHER, ADMIN | Resource picker (rooms / equipment, filters), availability calendar (day/week), free-room finder, booking form, my bookings (upcoming / past, cancel), offline read of my bookings |
| `/dashboard/admin/bookings` | ADMIN | Pending approvals (approve / reject with note), all bookings, equipment management, usage statistics with charts |
| `/dashboard/forum` | all | Question list (search, subject/level/tag filters, sort, unanswered), ask form with similar-question suggestions while typing the title, offline read |
| `/dashboard/forum/[id]` | all | Question, answers (accepted first, "Certified" badge for teachers), votes, accept, follow, report, answer form (works offline: queued with `clientRequestId`, shown as "waiting to sync") |
| `/dashboard/forum/profile/[userId]` | all | Reputation, badges, answers by subject |
| `/dashboard/admin/forum` | ADMIN | Reports queue, hide/unhide, resolve |
| `/dashboard/analytics` | STUDENT | Attendance per subject with alert levels, grades and averages, progress chart, activity chart, group comparison switch, "Download my report (PDF)" |
| `/dashboard/attendance` | TEACHER, ADMIN | Today's/recent sessions → roll call (Present / Absent / Late, bulk "All present"), Excused for ADMIN |
| `/dashboard/grades` | TEACHER, ADMIN | Assessments per subject/group, grade entry table, publish |
| `/dashboard/admin/analytics` | ADMIN | Attendance alerts, group overview, student detail + PDF |

Navigation (already added by the lead): STUDENT "Réservations / Bookings", "Forum", "Mon suivi / My progress";
TEACHER "Réservations", "Forum", "Présences / Attendance", "Notes / Grades"; ADMIN additionally
"Réservations et ressources / Bookings & resources", "Modération du forum / Forum moderation",
"Suivi des étudiants / Student follow-up". ALUMNI: "Forum".

## 5. Environment variables (new, backend)

`BOOKING_REMINDER_MINUTES=60`, `ABSENCE_WARNING_RATE=0.10`, `ABSENCE_ALERT_RATE=0.20`.

## 6. Demo data

Seed plugins: `scripts/seed/30-bookings.js` (equipment, a few bookings incl. one pending), `40-forum.js` (questions
per subject, answers incl. certified/accepted ones, votes, profiles/badges), `50-analytics.js` (attendance for
past sessions with one student above the warning and one above the alert threshold, assessments and published
grades for 4TWIN1).

## 7. File ownership (parallel work)

| Owner | Files |
|---|---|
| Backend bookings | `models/{equipmentModel,bookingModel,bookingSlotModel}.js`, `controllers/{resource,booking}Controller.js`, `routes/{resources,bookings}.js`, `service/bookingService.js`, `scripts/seed/30-bookings.js`, + the two Room fields (§1.1) |
| Backend forum | `models/forum*.js`, `controllers/forumController.js`, `routes/forum.js`, `service/forumService.js`, `scripts/seed/40-forum.js` |
| Backend analytics | `models/{attendanceRecord,attendanceAlert,assessment,grade}Model.js`, `controllers/{attendance,grade,analytics}Controller.js`, `routes/{attendance,grades,analytics}.js`, `service/{attendance,grade,analytics,report}Service.js`, `scripts/seed/50-analytics.js` |
| Web bookings | `app/(back)/dashboard/bookings/**`, `app/(back)/dashboard/admin/bookings/**`, `components/bookings/**`, `lib/bookings/**`, `messages/{fr,en}/bookings.json`, + the two Room fields in the admin academic room form |
| Web forum | `app/(back)/dashboard/forum/**`, `app/(back)/dashboard/admin/forum/**`, `components/forum/**`, `lib/forum/**`, `messages/{fr,en}/forum.json` |
| Web analytics | `app/(back)/dashboard/{analytics,attendance,grades}/**`, `app/(back)/dashboard/admin/analytics/**`, `components/analytics/**`, `lib/analytics/**`, `messages/{fr,en}/analytics.json` |
| Tests | `tests/**` |

Each module documents itself in a new `backend/docs/<module>.md` and `next/docs/<module>.md` (instead of editing
the shared READMEs). Module agents never install packages and never edit other files; anything else they need is
reported.
