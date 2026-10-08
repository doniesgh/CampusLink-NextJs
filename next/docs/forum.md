# Help forum — web (Module 4)

Phase 2 contract, sections 2 and 4. API reference: [`backend/docs/forum.md`](../../backend/docs/forum.md).

## Files

| Path | Role |
| ---- | ---- |
| `app/(back)/dashboard/forum/layout.tsx` | Adds the `forum` messages to the Client Components of every forum page |
| `app/(back)/dashboard/forum/page.tsx` + `forum-view.tsx` | `/dashboard/forum`: search, filters, sort, list, ask form, top helpers |
| `app/(back)/dashboard/forum/[id]/page.tsx` + `question-view.tsx` | `/dashboard/forum/[id]`: question, answers, actions, answer form |
| `app/(back)/dashboard/forum/profile/[userId]/page.tsx` + `profile-view.tsx` | `/dashboard/forum/profile/[userId]` (`me` = signed-in user), Server Component |
| `app/(back)/dashboard/forum/actions.ts` | Server Actions: ask, edit, close/reopen, delete, follow, accept, vote, report, edit/delete answer |
| `app/(back)/dashboard/admin/forum/{layout,page}.tsx` + `moderation-view.tsx` | `/dashboard/admin/forum` (ADMIN): reports queue |
| `app/(back)/dashboard/admin/forum/actions.ts` | Server Actions (ADMIN): hide / unhide, resolve a report |
| `components/forum/*` | Cards, badges, vote control, forms, dialogs, plain-text renderer |
| `lib/forum/types.ts` | API shapes, limits (same as the backend models), runtime checks |
| `lib/forum/filters.ts` | URL filters, offline filtering and sorting of saved questions |
| `lib/forum/paths.ts` | Web pages, API paths, offline query keys (`forum:*`) |
| `lib/forum/validation.ts` | Form checks shared by the browser and the Server Actions |
| `lib/forum/queries.ts` | `useForumSubjects`, `useForumTags`, `useLeaderboard` (offline-first) |
| `lib/forum/pending.ts` | Offline answers: outbox path, `clientRequestId`, "Waiting to sync" list |
| `messages/{en,fr}/forum.json` | Texts (FR "tu"); same keys in both files |

## Pages

### `/dashboard/forum` (every role)

- h1 "Help forum". Header actions: link "My forum profile", button "Ask a question" (`aria-expanded`, opens the
  `#ask-question-panel` section; `?ask=1` opens it on load).
- Search form (`role="search"`): input "Search" (type search) + button "Search". Selects "Subject", "Level",
  "Tag" (most used tags of the chosen subject, "sql (3)"), "Sort by" ("Best match" only with a search, "Newest",
  "Most votes", "Recent activity"), checkbox "Unanswered only" (API `sort=unanswered`: no visible answer, newest
  first; disables "Sort by"), button "Reset filters" when a filter is set.
- Filters live in the URL (`?q&subject&level&tag&sort`), replaced with `history.replaceState` (no server round
  trip). The server renders the first page of the URL's filters; other combinations come from `useOfflineQuery`.
- Each question is an `article[data-question-id][data-status][data-hidden]` (`question-card.tsx`) whose title
  (h3) links to the question (the whole card is clickable): subject pill (`[data-subject="<code>"]`), "Solved",
  "Teacher answer", "Closed", "Hidden" (ADMIN / author only), a 2-line excerpt, tag chips (buttons named "Show the
  questions tagged <tag>", `aria-pressed`, they filter the list in place), "<n> votes", "<n> answers" (green with
  a check when solved), "<n> views", "Asked by <author>" (profile link) and the date. Count text
  `[data-testid="forum-count"]` ("16 questions"); pages of 20 with "Load more".
- Ask form (`question-form.tsx`): "Title" (10–200), "Subject", "Level (optional)", "Details" (20–10 000),
  "Chapter (optional)", "Tags (optional)" (comma separated, at most 5), buttons "Cancel" / "Post question".
  Errors are shown under the fields (first invalid field focused), checked in the browser then by the Server
  Action, then by the API. While the title is typed (8+ characters, 400 ms debounce, online), "Similar questions
  already asked" (`[data-testid="similar-questions"]`, `aria-live="polite"`) lists up to 5 questions with
  "Solved" or "<n> answers"; links open in a new tab so the draft stays. Posting opens the new question.
- Aside "Top helpers this year" (academic year, 5 best, links to their profiles).
- After a question is deleted, the list shows "Your question was deleted." (`?done=deleted`, then removed from
  the address).

### `/dashboard/forum/[id]` (every role)

- "Back to the forum", subject / "Solved" / "Closed" / "Hidden" pills, h1 = title, "Asked by <author> (<role>)",
  date, "edited <date>", "<n> views", level ("4th year") and chapter, body `[data-testid="question-body"]`, tags
  (links to the list filtered by the tag).
- Group "Question actions": vote control (group "Votes on the question": buttons "Upvote" / "Downvote" with
  `aria-pressed`, score `[data-testid="vote-score"][data-score]`; disabled on one's own post, on hidden content and
  offline), "Follow" / "Unfollow" (+ "You get a notification for each new answer."), and depending on the viewer:
  "Edit" (author, inline form "Edit your question", "Save changes"), "Close question" / "Reopen question" (author
  or ADMIN), "Delete" → "Confirm delete" (author or ADMIN, only without answers), "Report" (dialog "Report this
  question", textarea "Reason" 5–500, "Send report"), "Hide" (ADMIN, dialog with "Reason (optional, shown to the
  author)") / "Unhide".
- Hidden content (ADMIN and author only) shows `[data-testid="hidden-notice"]`: "Hidden by the moderation team",
  who can see it, "Reason: …".
- h2 "<n> answers"; each answer is an `article#answer-<id>[data-answer-id][data-accepted][data-certified][data-hidden]`
  (`tabIndex=-1`; notification links `/dashboard/forum/<id>#answer-<answerId>` scroll to it and focus it, also when
  the page streams in after the browser looked for the anchor). Accepted first, then by score (API order; votes do
  not reorder the list until the next load). Pills "Accepted answer" and "Certified" (teacher; the accessible
  name adds "Answer from a teacher"), body `[data-testid="answer-body"]`, "Answered by <author> (<role>)", group
  "Answer actions": votes (group "Votes on the answer"), "Accept this answer" / "Remove acceptance" (question
  author; the API returns the re-sorted thread), "Edit" (author, "Edit your answer", "Save answer"), "Delete"
  (author or ADMIN, not the accepted answer), "Report" (dialog "Report this answer"), "Hide" / "Unhide" (ADMIN).
- Section "Answer this question": textarea "Your answer" (2–10 000) and "Post answer"; replaced by "This question
  is closed: it doesn't take new answers." (CLOSED) or "This question is hidden: …" (hidden).
- Outcomes are shown next to what was done (one `role="status"` / `role="alert"` at a time in `<main>`): under the
  question actions, under the answer, above the answers ("Your answer was deleted.") or under the answer form.

### `/dashboard/forum/profile/[userId]` (every role)

Server Component. "Back to the forum", initials, h1 = name, role pill (`[data-role]`), "This is you" on one's own
profile. Statistics (`dl`, `[data-stat]`): "Reputation", "This year (2026-2027)", "Questions", "Answers", "Accepted
answers", and how points are earned. "Badges" (`[data-badge-code]`: "First answer", "Active contributor",
"Helpful", "Expert in <subject>", with what they reward and "Earned on <date>"). "Answers by subject": table
"Subject" / "Answers" / "Points" (with a bar). `me` shows the signed-in user. Unknown user → "This profile isn't
available.".

### `/dashboard/admin/forum` (ADMIN; other roles are sent to `/dashboard`)

h1 "Forum moderation"; navigation "Report status" with links "Open" (+ count) / "Resolved" (`?status=RESOLVED`,
`aria-current="page"`), "<n> open reports" (`[data-testid="open-reports"]`), pages of 20 (server pagination).
Each report is an `article[data-report-id][data-status][data-target-type]`: "Question" / "Answer" pill,
"Hidden", outcome ("Content hidden" / "No action"), the content's title ("Answer to: <title>" for answers) and
plain-text excerpt, "By <author>", "Reason", "Reported by <reporter>" and the date, and once resolved "Resolved by
<admin>", "Note: …". Actions: "View in the forum" (answers link to their anchor), "Hide" (dialog with the optional
reason; hiding resolves every open report of that content) / "Unhide", "Resolve" (dialog with "Note (optional)").
The Server Actions call `refresh()`, so the queue is rendered again.

## Data, mutations and offline mode

- Every page renders its first data on the server (`serverSnapshot` / `serverApi`) and hands it to
  `useOfflineQuery`: keys `forum:list:<q>:<subject>:<level>:<tag>:<sort>:<page>`, `forum:question:<id>`,
  `forum:subjects`, `forum:tags:<subject>`, `forum:leaderboard`.
- Reads offline: the service worker saves `/dashboard/forum` (and its filtered URLs) and the question pages the
  user opened (phase 2 contract section 0). We do **not** pre-save question pages in the background: rendering a
  question page counts a view (`GET /questions/:id`), so only pages really opened are saved. Offline:
  - the list shows the saved data of the filters; a combination never loaded on this device filters the saved
    default list locally ("You're offline: here are the saved questions that match.");
  - a click on a question opens the saved page with a full load (answered by the service worker), or says "This
    question isn't saved on this device yet. …" when it was never opened (`isPageSaved` / `openPageFully` of
    `lib/announcements/offline.ts`);
  - on the question page, every action but answering is disabled ("You're offline: votes, follows, reports and
    edits come back with the connection. You can still write an answer.").
- Mutations that can fail with an expected 4xx (everything except answers) are **Server Actions** with
  `serverApi()` (no failed request in the browser console); the page updates its offline query with the returned
  data (`mutate`) instead of rendering again. Forum-specific wording for some codes: `FORBIDDEN` on a vote ("You
  can't vote on your own post."), on accept ("Only the author of the question can accept an answer."),
  `INVALID_STATE` on delete ("A question that has answers can't be deleted." / "The accepted answer can't be
  deleted."), hidden content, `RESOURCE_NOT_FOUND` ("This content doesn't exist anymore.").
- **Answers work offline** (`components/forum/answer-form.tsx`, `lib/forum/pending.ts`):
  `queueMutation({ method: "POST", path: "/forum/questions/<id>/answers#<clientRequestId>", body: { body,
  clientRequestId } })` with a new UUID per answer (`crypto.randomUUID()`, with a `getRandomValues` fallback on
  plain-http hosts). The outbox keeps one entry per method + path ("last write wins"), so the fragment gives each
  answer its own entry; browsers never send a fragment, so the request is still `POST
  /api/forum/questions/:id/answers`. Online → "Your answer was posted." (201, or 200 for a replay). Offline or
  server unreachable → "You're offline: your answer will be posted as soon as you're back online.", the answer is
  listed as `article[data-pending="true"]` with "Waiting to sync" (read back from the outbox, refreshed when the
  pending count changes or the outbox is replayed), and the banner says "<n> changes waiting to sync". On
  reconnection (page or Background Sync), the outbox is replayed, the thread is fetched again and the pending
  cards disappear. A replay of the same `clientRequestId` returns the first answer (no duplicate).
- Never HTML: titles, bodies, reasons and notes are rendered as text (`ForumText`: line breaks kept, http(s)
  links with `rel="noopener noreferrer nofollow ugc"`).

## Checks

- `npx tsc --noEmit --incremental false`, `npm run lint`, `NEXT_DIST_DIR=.next-forum npx next build`.
- End-to-end (production build, real backend and MongoDB, demo seed): every page for STUDENT, TEACHER, ADMIN and
  ALUMNI, in English and French, desktop (1366×900) and mobile (390×844), light and dark, without horizontal
  scroll, console errors or CSP violations: filters and URL state, ask with similar questions and validation,
  HTML shown as text, follow / edit / close / reopen / delete, votes, report, answers (post, edit, delete, accept,
  certified), notification anchor, moderation (hide with a reason, resolved tab, unhide, resolve with a note,
  answer hide/unhide), hidden content seen by its author and invisible to others, access to the moderation page,
  and offline: saved list and question, local filtering, two answers queued offline then replayed exactly once.

## Known limits

- An answer rejected for good when replayed (e.g. the question was closed or hidden meanwhile) is dropped by the
  outbox (phase 1 rule for 4xx answers), so its text is lost; the pending card disappears without a message.
- Votes do not reorder the answers until the thread is loaded again (no jump under the pointer).
- The profile page is not saved for offline use (only `/dashboard/forum` and `/dashboard/forum/<id>` are, phase 2
  contract section 0).
