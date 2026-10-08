# Attendance, grades and student analytics — web (Module 9)

Phase 2 contract, sections 3 and 4 ([`docs/phase2-contract.md`](../../docs/phase2-contract.md)); API shapes in
[`backend/docs/analytics.md`](../../backend/docs/analytics.md). Everything in [`next/README.md`](../README.md) still
applies (BFF, offline data layer, Server Actions for mutations that can fail with a 4xx, CSP, message namespaces).

## Files

| Path | Role |
| ---- | ---- |
| `app/(back)/dashboard/analytics/` | "My progress" (STUDENT): `page.tsx` (server snapshot), `layout.tsx` (adds the `analytics` client messages) |
| `app/(back)/dashboard/attendance/` | Session list (`page.tsx`), roll call (`[sessionId]/page.tsx`), `actions.ts` (`saveRollCallAction`) |
| `app/(back)/dashboard/grades/` | Classes and assessments (`page.tsx`), grade entry (`[assessmentId]/page.tsx`), `actions.ts` (create / edit / delete / publish assessments, save grades) |
| `app/(back)/dashboard/admin/analytics/` | Student follow-up (ADMIN): alerts and groups (`page.tsx`), student detail + PDF (`students/[id]/page.tsx`); `layout.tsx` adds `admin` + `analytics` messages |
| `components/analytics/` | Client components (below) |
| `lib/analytics/types.ts` | API types, constants (`LEVELS`, `ATTENDANCE_STATUSES`, `ASSESSMENT_TYPES`), shape guards |
| `lib/analytics/paths.ts` | Web and API paths, PDF URLs, the 7-day session window, `levelVariant`, `buildQuery` |
| `messages/{en,fr}/analytics.json` | Namespace `analytics` (same keys in both files; French uses "tu") |

Components: `student-overview.tsx` (the student view shared by the student page and the admin detail),
`my-progress-view.tsx` (student page: offline query, comparison switch, PDF button), `staff-student-view.tsx` (admin
detail), `attendance-by-subject.tsx`, `grades-panel.tsx`, `progress-chart.tsx`, `activity-chart.tsx`,
`chart-parts.tsx` (chart colour tokens, tooltip box, "Show as a table"), `comparison-panel.tsx`, `level-badge.tsx`
(`LevelBadge`, `SubjectLabel`), `stat-tile.tsx`, `session-list.tsx`, `roll-call-editor.tsx`, `grades-manager.tsx`,
`assessment-dialog.tsx`, `grade-sheet-editor.tsx`, `follow-up-tabs.tsx`, `alerts-panel.tsx`,
`group-overview-panel.tsx`, `url-select.tsx` (native select whose value lives in the URL), `page-feedback.tsx`,
`use-analytics-format.ts` (percent, grade "13.5/20", hours, dates in the campus timezone).

## Pages

### `/dashboard/analytics` — "My progress" / "Mon suivi" (STUDENT)

- Rendered on the server (`serverSnapshot("/analytics/me")`), then `useOfflineQuery(["analytics", "me"])`: the data is
  kept in IndexedDB and the service worker already saves this page (phase 2 contract section 0), so it opens offline
  with "Saved copy from <time>." and the connectivity banner.
- Key figures (`<dl>`): attendance rate (= 1 − absence rate) with the worst level, overall average, hours missed
  (excused hours shown, not counted), late arrivals. A callout lists the subjects above the warning / alert thresholds.
- "Attendance by subject": one meter per subject (`role="meter"`, shared scale, marks at the warning and alert
  thresholds), level badge (icon + text: "On track" / "Warning" / "Alert"), hours in words.
- "Progress": recharts line of the overall average after each graded assessment (0–20), latest value labelled; with
  the comparison on, a dashed "Group average" reference line.
- "Grades": averages by subject and the table of published assessments (score, out of 20, coefficient, comment).
- "Activity": stacked columns of the last 12 weeks (announcements read, forum questions, forum answers).
- "Compare with my group" (`role="switch"`, off by default = opt-in) loads `/analytics/me?compare=true` (also kept for
  offline reading once loaded). Groups under 5 students: "The comparison isn't available…". Only group averages.
- "Download my report (PDF)": a plain link to `/bff/analytics/me/report.pdf?locale=<UI language>` (the BFF passes the
  attachment through); disabled offline ("The report needs a connection.").

### `/dashboard/attendance` — "Attendance" / "Présences" (TEACHER, ADMIN)

- Sessions of a 7-day window (`?date=YYYY-MM-DD` = last day, default today; "Previous 7 days" / "Next 7 days" /
  "Today"), grouped by day, today first. TEACHER: the sessions they teach; ADMIN: every session with "Group" and
  "Teacher" filters (`?group=&teacher=`).
- Each session is an `article[data-session-id][data-status][data-state]` (`open` | `notOpen` | `closed` |
  `cancelled`) with time, groups, room, "12/25 marked", absent / late / excused counts and a link "Take attendance" /
  "Edit attendance" / "View attendance". Not open yet: "Opens at 10:00" (15 minutes before the start).
- `/dashboard/attendance/<sessionId>`: the roll call. One fieldset per student (named by the student, `li[data-student-id]
  [data-status]`) with native radios "Present" / "Absent" / "Late" (+ "Excused" for ADMIN; arrow keys move between
  them), "Clear", an optional note. "All present" marks everyone present except excused students (a teacher can't
  change an absence excused by the administration: "Excused by the administration.", radios disabled). "Save
  attendance" sends only the changed rows (`saveRollCallAction` → `PUT /api/attendance/sessions/:id`) and shows
  "Attendance saved (n changes)."; the unsaved count is live and leaving the page with unsaved marks asks for
  confirmation. Outside the teacher's window the page is read-only ("Attendance closed on …"); the backend reasons
  `ROLL_CALL_NOT_OPEN`, `ROLL_CALL_CLOSED`, `EXCUSED_ADMIN_ONLY`, cancelled sessions and students no longer in the
  roster have their own messages. Offline, saving keeps the draft and says so (no offline queue: a roll call is
  validated against a time window).
- Phones: the save bar sticks above the bottom navigation.

### `/dashboard/grades` — "Grades" / "Notes" (TEACHER, ADMIN)

- "Class" select (`?subject=&group=`, options grouped by group): the (subject, group) pairs the teacher teaches this
  year (`GET /api/grades/teaching`); ADMIN gets every pair with "Taught by …".
- Assessments of the class (`article[data-assessment-id][data-published]`): date, scale and coefficient, type,
  "Published" / "Not published", "8/25 graded", class average; "Enter grades", "Edit", "Publish" (confirmation:
  students are notified once, no unpublish) and "Delete" (confirmation). "New assessment" opens a dialog ("Title",
  "Type", "Date", "Maximum score", "Coefficient"; decimal comma accepted). Server Actions + `refresh()`.
- `/dashboard/grades/<assessmentId>`: grade sheet with statistics (graded, class average, lowest, highest), one score
  input per student (empty = not graded, `12,5` or `12.5`, checked against the maximum before sending), live "out of
  20", comment; Enter moves to the next student. "Save grades" sends the changed rows; "Publish" is available once
  everything is saved.

### `/dashboard/admin/analytics` — "Student follow-up" / "Suivi des étudiants" (ADMIN)

- Tabs "Alerts" / "Groups" (`?tab=groups`, Radix tabs; the server renders only the active tab).
- Alerts: filters "Group", "Level", "Subject" in the URL, paginated table (student → detail, level, subject, rate when
  raised, group, date).
- Groups: "Group" / "Subject" selects, summary tiles (students, average attendance, average grade, students per
  level) and one row per student (level, absences, average, hours missed, late), local "Sort by".
- `/dashboard/admin/analytics/students/<id>`: the student overview with neutral wording, the comparison switch
  (fetched on demand, never stored on the device) and the PDF report with "Report language" (student's language,
  French, English).

## Charts and accessibility

- recharts 3 with `responsive` (CSS sizing, no ResponsiveContainer), `accessibilityLayer={false}` and no animation;
  each chart is a `figure` with a written summary (`figcaption`), a `role="img"` plot labelled by that summary, a hover
  tooltip, and a "Show as a table" disclosure with every value. Single-series charts have no legend (the title names
  the series); the activity chart has a legend above the plot.
- Colours: the single series and the three activity series use `--chart-1..3`, defined on the chart wrapper
  (`CHART_TOKENS` in `chart-parts.tsx`, light and dark steps through Tailwind's `dark:` = `prefers-color-scheme`).
  The set was checked for colour-vision deficiencies against the light and dark card surfaces; axes, grid and text use
  the app tokens. Levels always come with an icon and a word.
- Page-level feedback goes through `PageFeedback` (an opaque surface under `InlineFeedback`), so the success message
  keeps a 4.5:1 contrast on the `bg-muted` dashboard area.
- At most one `role="status"` and one `role="alert"` inside `<main>` at a time.

## Messages

Namespace `analytics`: `levels`, `statuses`, `assessmentTypes`, `units`, `offline`, `student`, `overview` (shared
student view; `self` / `staff` variants where the wording differs), `attendance` (+ `rollCall`), `grades` (+ `form`,
`sheet`), `followUp`. Session types reuse `timetable.session.types`. The client layouts of the four routes add
`analytics` to `DASHBOARD_NAMESPACES` (and `admin` for the follow-up page).

## Test hooks

`[data-figure="attendance|overall"]`, `li[data-subject=<code>][data-level]`, `[data-callout]`, `[data-chart="progress|activity"]`,
`[data-comparison="available|unavailable"]`, `[data-testid="report-download"]`, `article[data-session-id][data-state]`,
`li[data-student-id][data-status]`, `[data-testid="roll-call-window"]`, `article[data-assessment-id][data-published]`,
`[data-testid="publication-state"]`, `tr[data-alert-id][data-level]`, `tr[data-student-id][data-level]`,
`[data-level-count]`.
