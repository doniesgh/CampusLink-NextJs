# Help forum — `/api/forum` (Module 4)

Phase 2 contract, section 2. Questions by subject, answers (certified when written by a teacher), votes, accepted
answers, reputation and badges, follows with `FORUM` notifications, full-text search, offline-safe answers and
moderation.

Code: `models/forum{Question,Answer,Vote,Profile,Follow,View,Report}Model.js`, `service/forumService.js` (rules,
reputation, notifications, concurrency), `controllers/forumController.js` (HTTP parsing, validation, audit),
`routes/forum.js`, seed `scripts/seed/40-forum.js`.

Every route needs `Authorization: Bearer` (`401 AUTH_REQUIRED` / `TOKEN_EXPIRED` / `INVALID_TOKEN`). Any role
(STUDENT, TEACHER, ADMIN, ALUMNI) reads, asks, answers, votes, follows and reports; moderation routes are ADMIN only
(`403 FORBIDDEN`). Ids in the path are checked (`400 INVALID_ID`); unknown or invisible content → `404 RESOURCE_NOT_FOUND`.

## Endpoints

| Endpoint | Who | Answer |
| -------- | --- | ------ |
| `GET /questions?q&subject&level&tag&status&sort&page&limit` | any | `{ items: [Question], total, page, limit }` |
| `GET /questions/similar?title=` | any | up to 5 `[{ id, title, answerCount, hasAcceptedAnswer }]` (a bare array) |
| `POST /questions` | any | `201` Question |
| `GET /questions/:id` | any | `{ question, answers: [Answer] }`, counts the view |
| `PATCH /questions/:id` | author (content), author or ADMIN (`status`) | `200` Question |
| `DELETE /questions/:id` | author or ADMIN, only without answers | `204` |
| `POST /questions/:id/answers` `{ body, clientRequestId? }` | any | `201` Answer, or `200` with the first answer (replay) |
| `PATCH /answers/:id` `{ body }` | author | `200` Answer |
| `DELETE /answers/:id` | author or ADMIN, not the accepted answer | `204` |
| `POST /questions/:id/accept` `{ answerId }` | question author | `{ question, answers }` (no view counted) |
| `POST /questions/:id/vote`, `POST /answers/:id/vote` `{ value: 1 \| -1 }` | any, not the author | `{ score, myVote }` |
| `POST /questions/:id/follow`, `DELETE /questions/:id/follow` | any | `{ following: true \| false }` (idempotent) |
| `POST /questions/:id/report`, `POST /answers/:id/report` `{ reason }` | any | `201` report, `200` with the user's open report |
| `POST /questions/:id/hide`, `POST /answers/:id/hide` `{ reason? }` | ADMIN | `200` Question / Answer (idempotent) |
| `POST /questions/:id/unhide`, `POST /answers/:id/unhide` | ADMIN | `200` Question / Answer (idempotent) |
| `GET /reports?status=OPEN\|RESOLVED&page&limit` | ADMIN | `{ items: [Report], total, page, limit, openCount }` |
| `POST /reports/:id/resolve` `{ note? }` | ADMIN | `200` Report; already resolved → `409 INVALID_STATE` |
| `GET /profiles/me`, `GET /profiles/:userId` | any | ForumProfile (zeros for a user without activity) |
| `GET /leaderboard?subject&limit` | any | `{ academicYear, subject, items: [{ rank, user, reputation, badges }] }` |
| `GET /tags?subject&limit` | any | `[{ tag, count }]`, most used first (extra, for filter chips) |

## JSON

```
Question { id, title, body, subject: { id, name, code, color } | null, chapter, level, tags,
           author: { id, firstname, lastname, role }, score, answerCount, acceptedAnswerId, hasCertifiedAnswer,
           following, myVote (1 | -1 | 0), viewCount, status: "OPEN" | "CLOSED", hidden, hiddenAt, hiddenReason,
           createdAt, lastActivityAt, editedAt }
Answer   { id, questionId, body, author: { id, firstname, lastname, role }, certified, accepted, score,
           myVote, hidden, hiddenAt, hiddenReason, createdAt, editedAt }
Report (reporter view, POST)  { id, targetType: "QUESTION" | "ANSWER", targetId, questionId, reason, status, createdAt }
Report (ADMIN view)           { id, targetType, targetId, questionId, reason, status: "OPEN" | "RESOLVED",
                                outcome: "HIDDEN" | "NO_ACTION" | null, note, reporter: { id, firstname, lastname, role },
                                target: { title, excerpt, author, hidden } | null, createdAt, resolvedAt, resolvedBy }
ForumProfile { user: { id, firstname, lastname, role }, reputation, questions, answers, acceptedAnswers,
               bySubject: { <subjectId>: points }, subjects: [{ subject: { id, name, code, color }, points, answers }],
               badges: [{ code, subject?: { id, name, code, color }, awardedAt }],
               season: { academicYear: "2026-2027", reputation } }
```

- `answerCount` counts the answers that are not hidden. `hasCertifiedAnswer` = a non-hidden TEACHER answer exists.
- Answers are sorted: accepted answer first, then by score, then oldest first.
- `following`, `myVote` and `accepted` are computed for the signed-in user. Authors are never sent with an email.
- `hiddenAt` / `hiddenReason` are only filled on hidden content, which only ADMINs and its author receive: clients
  show a notice ("Hidden by the moderation team" + reason).
- `subjects` (profile) lists the subjects with points or answers, best first; `bySubject` is the raw map of the
  contract. A `SUBJECT_EXPERT` badge has `subject`, the other badges have no `subject` key.

## Rules

- **Validation** (`400 VALIDATION_ERROR`, every invalid field in `details` at once): `title` 10–200 (one line:
  whitespace runs become one space), `body` 20–10000, answer `body` 2–10000 (plain text, trimmed, CRLF → LF, line
  breaks kept, HTML is stored and returned as text — clients never render it), `subject` an existing Subject id
  (required), `chapter` ≤ 100 (optional, `""`/`null` clears it), `level` integer 1–5 or `null`, `tags` array of at
  most 5 strings, lowercased, spaces → `-`, 2–30 characters of letters, digits and `+ # . _ -`, de-duplicated.
  Unknown body fields are ignored (no mass assignment of `score`, `author`, `hidden`...). `PATCH` without any known
  field → `400 NO_CHANGES`. Malformed JSON → `400 INVALID_JSON`.
- **Lists**: `sort=recent` (default; `relevance` by default when `q` is set), `votes`, `activity`
  (`lastActivityAt`: creation, new answer, accepted-answer change, content edit), `unanswered` (no visible answer,
  newest first). `tag` is matched lowercased. Repeated query parameters and bad values → `400 VALIDATION_ERROR`.
- **Search**: MongoDB text index on `title` (weight 5), `tags` (3), `body` (1) with `default_language: "none"` (no
  stemming nor stop words, so French and English behave the same; case and diacritics are ignored). `q` accepts the
  `$text` syntax (`"exact phrase"`, `-excluded`). **Similar questions** use the same index on the significant words of
  the title (French/English stop words removed), best match first; no significant word → `[]`.
- **Status**: the author or an ADMIN closes / reopens a question (`PATCH { status }`). A CLOSED or hidden question
  cannot receive answers (`409 INVALID_STATE`); votes and acceptance still work on CLOSED questions.
- **Delete**: a question only while it has no answer (hidden ones included), an answer unless it is accepted
  (`409 INVALID_STATE`). The reputation given by their votes is reversed; votes, follows, views and reports go too.
  ADMINs may delete under the same conditions (they normally hide). Audited as `forum.delete`.
- **Votes**: +1 / −1 (numbers only), one per user and target; the same value again removes the vote, the other
  value switches it. Own content → `403 FORBIDDEN`; hidden content (or an answer of a hidden question) →
  `409 INVALID_STATE` for ADMINs, `404` for the others.
- **Accept**: only the question author (`403 FORBIDDEN` otherwise, ADMINs included). `answerId` must be a visible
  answer of that question (`404`), not hidden (`409`); accepting another answer moves the acceptance, `answerId: null`
  removes it. The author may accept their own answer (no reputation for that).
- **Views**: `GET /questions/:id` increments `viewCount` at most once per user and campus day (`APP_TIMEZONE`),
  authors included. `ForumView` keeps `(question, user, day)` with a unique index (concurrent views count once) and a
  2-day TTL.
- **Visibility**: hidden content is visible only to ADMINs and its author (lists, search, similar, tags, detail,
  votes, follows, reports and answers all apply it). Hiding a question hides its whole thread for the others.

### Reputation and badges

| Event | Points (to) |
| ----- | ----------- |
| Upvote on an answer / on a question | +10 / +5 (author of the content) |
| Downvote | −2 (author of the content) |
| Accepted answer | +15 to the answer author, +2 to the question author (not when accepting one's own answer) |
| Vote removed, accepted answer changed or removed, content deleted | the exact reverse |

- Profiles are updated incrementally (`$inc`, safe under concurrency). `ForumProfile.points` is the raw sum and may
  go below 0; the API shows `reputation = max(0, points)` (same for `bySubject` and the season): reputation is
  never below 0, and removing a vote always reverses exactly what it gave (no reputation farming by toggling a
  downvote on a user at 0).
- Points go to the subject of the question (stored on each vote and answer when created, so a later subject change
  of the question does not move them). `season` = points earned during the current academic year (1 September,
  campus time), reset by the first reputation event of a new year; the leaderboard ranks it.
- `forumService.recomputeProfile(userId)` rebuilds a profile from the data (same rules); the seed uses it.
- **Badges** (awarded once, atomically, kept when counters go down later, `FORUM` notification + push):
  `FIRST_ANSWER` (1 answer), `ACTIVE_CONTRIBUTOR` (10 answers), `HELPFUL` (5 accepted answers on other users'
  questions), `SUBJECT_EXPERT` (50 points in one subject, one badge per subject).

### Notifications (`type: "FORUM"`, recipient's locale, in-app + push)

| When | Who | Title (fr / en) | `data` |
| ---- | --- | --------------- | ------ |
| New answer | followers except the answerer (authors follow their questions automatically) | `Nouvelle réponse : « <title> »` / `New answer: "<title>"` | `{ kind: "NEW_ANSWER", questionId, answerId }` |
| Answer accepted | the answer author (not when self-accepted) | `Ta réponse a été acceptée` / `Your answer was accepted` | `{ kind: "ANSWER_ACCEPTED", questionId, answerId }` |
| New badge | the user | `Nouveau badge : <label>` / `New badge: <label>` | `{ kind: "BADGE", badge, subjectId }` |

Links: `/dashboard/forum/<questionId>#answer-<answerId>` (the web page should give each answer `id="answer-<id>"`) and
`/dashboard/forum/profile/<userId>` for badges. Replayed answers (`200`) notify nobody.

### Offline answers (`clientRequestId`)

`POST /questions/:id/answers` accepts `clientRequestId` (any UUID, case-insensitive, stored lowercase). The same
author + id returns the first answer with `200` instead of creating a duplicate — also for concurrent replays (unique
partial index `(author, clientRequestId)`). The same id reused by the same author on **another** question →
`409 ALREADY_EXISTS` (`details.field: "clientRequestId"`). Another author may use the same id. After the answer is
deleted, the id can be used again.

### Moderation

- Reports: `reason` 5–500. One open report per user and target (reporting again returns it with `200`); after it is
  resolved the user can report again. Reports of deleted content are removed with it.
- Hide / unhide (ADMIN, optional `reason` ≤ 500 shown to the author): idempotent (no second audit entry). Hiding
  resolves the open reports of that content (`outcome: "HIDDEN"`). Hiding an answer updates `answerCount` and
  `hasCertifiedAnswer`; an accepted answer may be hidden (it stays accepted).
- Resolve (ADMIN, optional `note` ≤ 500): `outcome` is `HIDDEN` when the content is hidden at that time, else
  `NO_ACTION`.
- Audit actions: `forum.hide`, `forum.unhide`, `forum.delete` (`targetType` `ForumQuestion` / `ForumAnswer`,
  `metadata: { questionId, authorId, reason? | byAuthor }`).

## Concurrency

No transactions (MongoDB without replica set):

- **Votes**: one atomic upsert per request (`findOneAndUpdate` with an update pipeline returning the previous value),
  then `$inc` of the score and the reputation by the exact delta. Any number of concurrent votes of the same user stay
  consistent.
- **Answers vs question delete**: posting an answer first reserves it (`$inc answersTotal` on an OPEN, non-hidden
  question); the delete only matches `answersTotal: 0`. One of the two wins, never both.
- **Accept vs answer delete**: the answer is first marked `deleting`, the question counters are only decremented if
  it is not the accepted answer; accepting is a compare-and-set on `acceptedAnswer` that undoes itself if the answer
  is being deleted.
- Views (unique `(question, user, day)`), follows (unique `(question, user)`), reports (unique open report per
  reporter and target), profiles (unique `user`) and badges (conditional `$push`) are all idempotent.

## Models (names are part of the contract)

| Model | Collection | Notes |
| ----- | ---------- | ----- |
| `ForumQuestion` | `forumquestions` | `author`, `subject`, `createdAt` (analytics reads them), counters, `acceptedAnswer`, moderation fields |
| `ForumAnswer` | `forumanswers` | `question`, `author`, `subject` (copy), `createdAt`, `certified`, `clientRequestId` |
| `ForumVote` | `forumvotes` | unique `(user, targetType, target)`; `targetAuthor`, `subject` copied at the first vote |
| `ForumProfile` | `forumprofiles` | unique `user`; raw `points`, `bySubject`, `answersBySubject`, `season`, `badges` |
| `ForumFollow`, `ForumView`, `ForumReport` | | follows, daily views (TTL 2 days), reports |

## Demo data (`scripts/seed/40-forum.js`)

16 questions in every demo subject (French, some in English), 33 answers (13 by teachers, 11 accepted, one hidden by
the moderation team with a resolved report), 77 votes, follows, a reported "for sale" post (2 open reports), one
CLOSED question and two unanswered ones. Profiles are recomputed from that data and badges awarded without
notifications: Amira Ben Salah `HELPFUL` + `SUBJECT_EXPERT` (BDD), Karim Trabelsi `SUBJECT_EXPERT` (WEB), Leila Gharbi
`SUBJECT_EXPERT` (ML), Yasmine Haddad `ACTIVE_CONTRIBUTOR`, `FIRST_ANSWER` for every answerer. Idempotent: the demo
questions (same author and title) are deleted with everything attached, then created again.
