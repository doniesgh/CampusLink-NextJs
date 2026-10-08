# Attendance, grades and analytics — `/api/attendance`, `/api/grades`, `/api/analytics` (Module 9)

Phase 2 contract, section 3 ([`docs/phase2-contract.md`](../../docs/phase2-contract.md)). Roll call per class session,
absence rates and alerts, assessments and grades with weighted averages, the student dashboard (attendance, grades,
trend, activity, opt-in group comparison), staff group views and a PDF progress report.
Everything in the phase 1 conventions still applies: `{ error, code, details? }` errors, string `id`, ISO 8601 UTC
dates, `{ items, total, page, limit }` pagination, campus timezone `APP_TIMEZONE` (default `Africa/Tunis`).

| File | Role |
| ---- | ---- |
| `models/attendanceRecordModel.js` | `AttendanceRecord` (unique `(session, student)`, `serializeRecord`, `RECORD_POPULATE`) |
| `models/attendanceAlertModel.js` | `AttendanceAlert` (unique `(student, subject, level)`) |
| `models/assessmentModel.js` | `Assessment` |
| `models/gradeModel.js` | `Grade` (unique `(assessment, student)`) |
| `service/attendanceService.js` | roll-call window, rosters, absence rates, alerts + notifications, scheduler job |
| `service/gradeService.js` | "teaches this subject to this group", weighted averages and trend, a student's grades, publication notification |
| `service/analyticsService.js` | student view, 12-week activity, group comparison, staff group overview |
| `service/reportService.js` | PDF report (pdfkit) |
| `controllers/{attendance,grade,analytics}Controller.js`, `routes/{attendance,grades,analytics}.js` | HTTP layer |
| `scripts/seed/50-analytics.js` | demo attendance, alerts, assessments and grades |

Every route needs `Authorization: Bearer` (`401 AUTH_REQUIRED` / `TOKEN_EXPIRED` / `INVALID_TOKEN`); a wrong role
gives `403 FORBIDDEN`. Ids in the path are checked (`400 INVALID_ID`), unknown ones give `404 RESOURCE_NOT_FOUND`.

## Definitions

- **Held session**: a `ClassSession` that is `SCHEDULED` and already ended (`endsAt ≤ now`). Cancelled sessions
  never count, nor sessions that have not ended yet.
- **Absence rate** of a student in a subject = unexcused `ABSENT` hours / hours of the held sessions of that subject
  for the student's **current group**, inside the group's academic year (1 September → 31 August). `LATE` counts as
  present, `EXCUSED` is not an absence, a student without a mark is not absent. 0 when nothing was held.
  Every `rate` / `overallRate` / `averageRate` of this module is an **absence** rate between 0 and 1 (4 decimals);
  an attendance rate is `1 - rate`.
- **Levels**: `OK`, `WARNING` (rate ≥ `ABSENCE_WARNING_RATE`, default 0.10), `CRITICAL` (rate ≥ `ABSENCE_ALERT_RATE`,
  default 0.20). `level` is the level of the rate next to it; a student's `worstLevel` is the highest level of their
  subjects (alerts are per subject).
- **Averages** are on 20: each score is brought back on 20 (`score / maxScore × 20`) and weighted by the assessment's
  `coefficient`. Subject average = weighted mean of the graded assessments of the subject; overall average =
  weighted mean of every graded assessment (subjects have no coefficient). A `null` score is left out. Rounded to 2
  decimals; `null` when nothing is graded. Students, the comparison and the staff views only use **published**
  assessments.
- **Who teaches what**: a TEACHER teaches a subject to a group when they have a `SCHEDULED` session of that subject
  for that group in the current academic year (same rule as `timetableService.taughtSessionsFilter`).

## Attendance — `/api/attendance`

AttendanceRecord JSON:
```
{ id, session: { id, startsAt, endsAt, type, status, subject: { id, name, code, color } },
  student: { id, firstname, lastname }, status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED", note,
  markedBy: { id, firstname, lastname } | null, markedAt }
```

| Endpoint | Who | Answer |
| -------- | --- | ------ |
| `GET /sessions?from&to&group&teacher` | TEACHER, ADMIN | `{ from, to, items: [{ session, rollCall: { students, marked, counts: { PRESENT, ABSENT, LATE, EXCUSED } }, editable }] }` sorted by start |
| `GET /sessions/:sessionId` | the session's teacher, ADMIN | roll call (below) |
| `PUT /sessions/:sessionId` `{ records: [{ student, status, note? }] }` | the session's teacher (window), ADMIN | roll call + `changed` |
| `GET /me?from&to` | any (students get data) | `{ from, to, thresholds, items: [AttendanceRecord], summary }` |
| `GET /alerts?group&level&subject&student&page&limit` | ADMIN | `{ items: [Alert], total, page, limit }`, newest first |

- **Session list** (extension, not in the contract; for the roll-call page): TEACHER → the sessions they teach
  (optional `group`; `teacher` is ignored), ADMIN → every session (optional `group` / `teacher`). Default range: the
  last 7 days including today (campus timezone); `from` / `to` as in the timetable (`YYYY-MM-DD`, campus wall-clock
  or ISO), `to` exclusive, at most 31 days (`400 RANGE_TOO_LARGE`). Cancelled sessions are listed (`editable: false`).
  `rollCall.students` = students of the session's groups now; `marked` = records of the session.
- **Roll call** = `{ session: ClassSession, editable, canExcuse, window: { opensAt, closesAt }, roster: [{ student: { id,
  firstname, lastname, group: { id, name } }, status | null, note, markedAt }], summary: { students, marked, counts } }`.
  Roster = students (role STUDENT) of the session's groups, sorted by last name; `status: null` = not marked yet.
  `window` is the teacher's window (`startsAt − 15 min` → `endsAt + 7 days`); `editable` tells whether the caller may
  save now; `canExcuse` is true for ADMIN.
- **Saving** upserts only the listed students (others are left as they are). `status: null` clears a mark; an omitted
  `note` keeps the current one, `note: null` clears it (plain text, ≤ 500 characters). Unchanged entries are skipped
  (`changed` = number of records written). Rules, in this order:
  - not the session's teacher nor ADMIN → `403 FORBIDDEN`;
  - `CANCELLED` session → `409 INVALID_STATE` (also for ADMIN);
  - TEACHER outside the window → `403 FORBIDDEN`, `details: { reason: "ROLL_CALL_NOT_OPEN" | "ROLL_CALL_CLOSED",
    opensAt, closesAt }` (ADMIN: any time);
  - body: `records` array of 1..500 objects, `student` id, `status` ∈ the four values or `null` (required), no
    duplicate student → `400 VALIDATION_ERROR` with `details["records.<i>.<field>"]`;
  - a student outside the roster → `400 VALIDATION_ERROR` (`details["records.<i>.student"]`);
  - only ADMIN may set `EXCUSED` or change an `EXCUSED` mark → `403 FORBIDDEN`, `details: { reason:
    "EXCUSED_ADMIN_ONLY", students: [id] }`. A teacher may send `EXCUSED` for a student who already has it (no-op),
    so a full roster can be sent back as received. A teacher's write never overwrites an `EXCUSED` mark set
    meanwhile by an administrator (conditional upsert on the unique index; that change is skipped).
  - Concurrent saves are safe: one record per `(session, student)` (unique index, upserts), last write wins.
  - Audited `attendance.update` (target `ClassSession`, metadata `{ sessionId, subject, startsAt, changed, changes:
    [{ student, from, to }] }`, at most 100 changes listed) when something changed.
- **`/me`**: the caller's records for sessions starting in `[from, to)` (newest first) and `summary` = absence figures of
  the same range: `{ overallRate, heldHours, absentHours, excusedHours, lateCount, level, worstLevel, bySubject:
  [{ subject, heldHours, absentHours, excusedHours, lateCount, rate, level }] }`. Default range: the academic year of
  the student's group (the figures used by the alerts); at most 400 days. Other roles and students without a group
  get empty results. `session.status` lets clients flag a record of a session cancelled after the roll call (it
  does not count).
- **Alert** JSON: `{ id, student: { id, firstname, lastname, group: { id, name } | null }, subject: { id, name, code,
  color }, level: "WARNING" | "CRITICAL", rate, createdAt }` (`rate` = absence rate when the alert was raised).
  `group` filters on the student's current group. Invalid `level` / ids → `400 VALIDATION_ERROR`.

### Alerts and notifications

At most one alert per student, subject and level (unique index: concurrent evaluations create it once). When an
absence is recorded on a session that has already ended, the rates of those students for the session's subject are
evaluated at once; an absence marked during the session carries an internal `alertCheckAt` (the session end) and the
scheduler job `attendance.evaluate-alerts` (every `SCHEDULER_INTERVAL_MS`) evaluates it once the session is over
(a moved session is postponed, a cancelled or deleted one is dropped). Crossing both thresholds at once creates
`WARNING` and `CRITICAL`; the student gets **one** `ATTENDANCE` notification (in-app + push, their language, French
with "tu") for the highest new level, link `/dashboard/analytics`, `data: { subjectId, level, rate }`, e.g.
fr "Alerte absences : Bases de données" / en "Absence alert: Databases". Alerts are never deleted when a rate goes
down again (an absence excused later); they are only raised when absences are recorded.

## Grades — `/api/grades`

Assessment JSON (staff): `{ id, subject: { id, name, code, color }, group: { id, name, level, academicYear }, title,
type: "EXAM" | "QUIZ" | "PROJECT" | "LAB" | "OTHER", date, maxScore, coefficient, published, publishedAt,
createdBy: { id, firstname, lastname } | null, createdAt, updatedAt, stats: { students, graded, average } }`
(`stats.average` = class average on 20 of the graded scores, published or not).

| Endpoint | Who | Answer |
| -------- | --- | ------ |
| `GET /teaching` | TEACHER, ADMIN | `{ items: [{ subject, group, teachers: [{ id, firstname, lastname }] }] }`: (subject, group) pairs of the current academic year (TEACHER: their own; ADMIN: all). Extension for the grades page |
| `GET /assessments?subject&group&published&page&limit` | TEACHER, ADMIN | `{ items: [Assessment], total, page, limit }` newest first (default limit 50). TEACHER: only pairs they teach |
| `POST /assessments` `{ subject, group, title, type, date, maxScore?, coefficient? }` | teaches it, ADMIN | `201` Assessment |
| `GET /assessments/:id` | teaches it, ADMIN | Assessment |
| `PATCH /assessments/:id` `{ title?, type?, date?, maxScore?, coefficient? }` | teaches it, ADMIN | Assessment |
| `DELETE /assessments/:id` | teaches it, ADMIN | `204` (its grades are deleted); a **published** assessment only by an ADMIN, else `409 INVALID_STATE`, `details.reason: "PUBLISHED"` |
| `GET /assessments/:id/grades` | teaches it, ADMIN | grade sheet |
| `PUT /assessments/:id/grades` `{ grades: [{ student, score, comment? }] }` | teaches it, ADMIN | grade sheet + `changed` |
| `POST /assessments/:id/publish` | teaches it, ADMIN | Assessment; already published → `409 INVALID_STATE` |
| `GET /me` | STUDENT | `{ items, bySubject: [{ subject, average, assessments }], overall, trend: [{ date, average }] }` |

- Fields: `title` 1..200, `type` required, `date` = `YYYY-MM-DD` (00:00 campus time), campus wall-clock or ISO,
  `maxScore` number in ]0, 1000] (default 20), `coefficient` number in ]0, 100] (default 1); `subject` and `group`
  must exist (`400 VALIDATION_ERROR`, `details.subject` / `details.group` "Unknown …") and cannot be changed later;
  `published`, `publishedAt`, `createdBy` cannot be set. Missing required fields → `400 MISSING_FIELDS`; every
  invalid field is reported at once (`400 VALIDATION_ERROR`). Empty `PATCH` → `400 NO_CHANGES`. Lowering `maxScore`
  below an existing score → `400 VALIDATION_ERROR` (`details.maxScore`).
- A TEACHER who does not teach that subject to that group this year → `403 FORBIDDEN`, `details.reason: "NOT_TEACHING"`.
- **Grade sheet** = `{ assessment, grades: [{ student: { id, firstname, lastname }, score | null, comment, gradedAt }] }`:
  students of the group (sorted by name), then students graded before they left the group. `score` is a number
  between 0 and `maxScore` (rounded to 2 decimals) or `null` (not graded / absent), required in every entry;
  `comment` ≤ 500 characters (omitted = kept, `null` = cleared). Students outside the sheet, duplicates and invalid
  scores → `400 VALIDATION_ERROR` (`details["grades.<i>.<field>"]`). Upserts, safe under concurrency.
- **Publishing** is claimed atomically (`published: false → true`): concurrent requests give one `200` and `409`s, and
  the students of the group (plus any student graded in it) get **one** `GRADE` notification each, without the score
  (it may show on a lock screen): fr "Nouvelle note : Bases de données" / en "New grade: Databases", link
  `/dashboard/analytics`, `data: { assessmentId, subjectId }`. Grades stay editable after publication (no new
  notification, but audited). There is no unpublish.
- **Deleting** an assessment deletes its grades. Once published (students see the grades), only an ADMIN may delete
  it: a TEACHER gets `409 INVALID_STATE` with `details.reason: "PUBLISHED"` (checked and deleted in one atomic
  operation, so a publication in between cannot slip through).
- **Audit** (target `Assessment`, like `attendance.update`; metadata always holds the assessment values `{ assessmentId,
  subject, subjectCode, group, groupName, title, type, date, maxScore, coefficient, published, publishedAt }`):

  | Action | When | Extra metadata |
  | ------ | ---- | -------------- |
  | `grades.assessment.create` | `POST /assessments` | — |
  | `grades.assessment.update` | `PATCH /assessments/:id` that changes something | `fields`, `changes: { <field>: { from, to } }` |
  | `grades.assessment.delete` | `DELETE /assessments/:id` | `gradesDeleted`, `graded`, `grades: [{ student, score }]` (at most 100) |
  | `grades.publish` | `POST /assessments/:id/publish` | `notified` (students), `graded` |
  | `grades.update` | `PUT /assessments/:id/grades` that changes something | `changed`, `scoresChanged`, `commentsChanged`, `changes: [{ student, from, to }]` (score changes first, at most 100) |

  The summary says when grades were changed "after publication" or a published assessment was deleted. Comments are
  never copied into the audit log.
- **Students** (`/me`) only ever see published assessments: those of their current group, plus any other one they have
  a grade in. Item: `{ id, title, type, date, maxScore, coefficient, subject, group: { id, name }, publishedAt, score,
  scoreOn20, comment }` (newest first; `score: null` = not graded). Other students' grades are never returned.
  `trend` = overall average after each day with a graded assessment (`date` `YYYY-MM-DD`, campus timezone).

## Analytics — `/api/analytics`

| Endpoint | Who | Answer |
| -------- | --- | ------ |
| `GET /me?compare=true` | STUDENT | student view (below) |
| `GET /me/report.pdf?locale=fr\|en` | STUDENT | `application/pdf` (attachment) |
| `GET /groups/:groupId?subject` | TEACHER (groups they teach), ADMIN | group overview (below) |
| `GET /students/:id?compare=true` | ADMIN | student view of a STUDENT (others → `404 RESOURCE_NOT_FOUND`) |
| `GET /students/:id/report.pdf?locale=fr\|en` | ADMIN | `application/pdf` |

**Student view**:
```
{ student: { id, firstname, lastname, group: { id, name, level, academicYear, program } | null },
  academicYear, thresholds: { warning, critical },
  attendance: { overallRate, heldHours, absentHours, excusedHours, lateCount, level, worstLevel,
                bySubject: [{ subject, heldHours, absentHours, excusedHours, lateCount, rate, level }] },
  grades: { overall, bySubject: [{ subject, average, assessments }], trend: [{ date, average }],
            items: [same items as GET /api/grades/me] },
  activity: { weeks: [{ week, forumQuestions, forumAnswers, announcementsRead }] },
  comparison?: { available: false, minGroupSize: 5 }
             | { available: true, groupSize, attendance: { averageRate, bySubject: [{ subject, averageRate }] },
                 grades: { overall, bySubject: [{ subject, average }] } } }
```
- `attendance` = the academic-year figures of `/api/attendance/me`; `grades` = `/api/grades/me` (so one request feeds
  the dashboard and its offline copy). `assessments` = number of graded assessments of the subject.
- `activity.weeks`: the current week and the 11 before it, oldest first, `week` = Monday `YYYY-MM-DD` (campus
  timezone). Counts the student's `ForumQuestion` / `ForumAnswer` (field `author`, `createdAt`) and `AnnouncementRead`
  (`user`, `readAt`) documents, read through `mongoose.models` (0 when a model is not registered).
- `comparison` only with `?compare=true` (opt-in): group averages of the students of the caller's group, only when the
  group has at least 5 students (else `{ available: false, minGroupSize: 5 }`, also without a group).
  `attendance.averageRate` = mean of the students' overall absence rates; `grades` = means of the students' averages
  (students without a published grade are left out). Never any individual data:
  - **every figure is computed from at least 5 students** (`MIN_COMPARISON_GROUP_SIZE`), not only the group: a grade
    average with fewer graded students (e.g. a retake graded for one student) would be that student's own average,
    or could be derived from it (2 graded students: 2 × average − my own). Such a figure is `null`
    (`grades.overall`, or the `average` of that subject, which stays listed); an attendance subject with fewer than
    5 students is left out (`attendance.averageRate` would be `null`, which cannot happen: every student of the group
    shares its sessions);
  - grade averages are rounded to the nearest **0.5** (rates to 4 decimals), so the change of a group average over
    time (one more graded assessment, one student more or less) says less about a single student's grade.

**Group overview**:
```
{ group, subjects: [Subject], thresholds,
  students: [{ student: { id, firstname, lastname },
               attendance: { rate, heldHours, absentHours, excusedHours, lateCount, level, worstLevel, bySubject },
               grades: { average, bySubject: [{ subject, average, assessments }] } }],
  summary: { students, averageRate, averageGrade, levels: { OK, WARNING, CRITICAL } } }
```
Limited to `subjects`: for a TEACHER the subjects they teach in that group this year (none → `403 FORBIDDEN`,
`details.reason: "NOT_TEACHING"`; `?subject` they do not teach there → `403`); for an ADMIN every subject of the
group's timetable this year and of its assessments, or `?subject` (unknown → `400 VALIDATION_ERROR`). Grades are
published ones (the same figures the student sees). `summary.levels` counts students by `worstLevel`.

**PDF report**: A4, pdfkit standard Helvetica fonts, CampusLink indigo header with the generation date (campus
timezone), student, email, group and program, academic year, three key figures (overall absence rate, overall
average, absent hours), attendance table per subject (held hours, absent hours, rate, level, coloured when
WARNING / CRITICAL) with the thresholds, grades table per subject, overall weighted average and the list of
published assessments; table headers are repeated on each page and every page has a footer "Page n / N". Language:
`?locale=fr|en` (invalid → `400 VALIDATION_ERROR`), else the **student's** `locale` (also for admin downloads).
`Content-Disposition: attachment; filename="releve-campuslink-<lastname>-<firstname>-<date>.pdf"` (en:
`campuslink-report-…`), `Cache-Control: private, no-store`. Text uses the WinAnsi encoding of the standard fonts:
every French letter (é, è, à, ç, œ, ï, «, », …) is exact; letters outside it lose their accent when possible, else
become `?` (e.g. non-Latin scripts).

## Environment

`ABSENCE_WARNING_RATE` (0.10) and `ABSENCE_ALERT_RATE` (0.20), read at each request; `SCHEDULER_INTERVAL_MS` for the
alert job.

## Demo data — `scripts/seed/50-analytics.js`

Runs after `10-timetable.js`, idempotent (replaces what it created: `source: "SEED"` records, alerts and
assessments, and the grades of those assessments; also drops attendance records whose session no longer exists).
Sends no notification.
- The timetable plugin only creates the current week and the next 4, so this plugin copies the current week's weekly
  series (`source: "SEED"`) into the previous 5 weeks inside the academic year; `10-timetable.js` deletes them on
  its next run before re-creating its sessions.
- Attendance for every held seeded session of the demo groups: present (a few late outside 4TWIN1), except in
  4TWIN1: **Yasmine Haddad** above the warning threshold in one subject (WEB, ~14 %), **Sarra Mansouri** above the
  alert threshold (BDD, ~24 %), an excused absence and some late arrivals. The matching alerts are created.
- 7 assessments for 4TWIN1 (BDD, WEB, ENG; coefficients, a quiz on 10), 5 published with grades, the upcoming BDD
  exam (no grade) and a graded English test that is not published (students do not see it).
- In very early September (few held sessions) the plugin logs that the thresholds could not be reached.

## Notes

- `AttendanceRecord`, `AttendanceAlert`, `Assessment` and `Grade` reference `ClassSession`, `Subject`, `Group` and `User`;
  `DELETE /api/academic/subjects|groups/:id` does not count assessments in its `IN_USE` check yet (see the open
  issues of the phase 2 report), and deleting a session leaves its attendance records (they are ignored).
- Changing a student's group moves their absence figures to the new group's sessions (records of the old group stay
  but no longer count); their grades of the old group's assessments stay visible to them.
