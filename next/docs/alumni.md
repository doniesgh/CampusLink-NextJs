# Alumni directory and network — web (Module 6)

Phase 3 contract, sections 4 and 5 ([`docs/phase3-contract.md`](../../docs/phase3-contract.md)). API reference:
[`backend/docs/alumni.md`](../../backend/docs/alumni.md). Everything in [`next/README.md`](../README.md) still applies
(BFF, offline data layer, Server Actions for mutations that can fail with a 4xx, UI primitives, campus timezone, CSP,
FR "tu" / EN messages).

## Files

| Path | Role |
| ---- | ---- |
| `app/(back)/dashboard/alumni/layout.tsx` | Adds the `alumni` messages to the Client Components of the three pages |
| `app/(back)/dashboard/alumni/page.tsx` + `alumni-view.tsx` | `/dashboard/alumni`: tabs Directory / News / My mentoring (STUDENT) / All profiles (ADMIN) |
| `app/(back)/dashboard/alumni/[id]/page.tsx` + `profile-view.tsx` | `/dashboard/alumni/[id]`: profile and the mentoring panel |
| `app/(back)/dashboard/alumni/me/page.tsx` + `my-profile-view.tsx` | `/dashboard/alumni/me` (ALUMNI): tabs Profile / Mentoring / My posts / My data |
| `app/(back)/dashboard/alumni/actions.ts` | Server Actions: save profile, visibility + consent, erase my data, ask / accept / decline / close mentoring, publish / delete / hide / unhide a post |
| `components/alumni/directory.tsx`, `alumni-card.tsx` | Search, facet filters, sort, cards, "Load more" |
| `components/alumni/news-wall.tsx`, `post-card.tsx`, `post-composer.tsx` | News wall and "My posts" (composer, type / hidden filters, moderation) |
| `components/alumni/mentoring-list.tsx`, `mentoring-card.tsx`, `mentoring-rules.tsx`, `ask-mentoring.tsx` | Requests (both sides), the rules box, "Ask for mentoring" |
| `components/alumni/profile-form.tsx`, `list-editor.tsx`, `visibility-card.tsx`, `my-data.tsx` | Profile form, chip editors, consent, export / erasure |
| `components/alumni/support-list.tsx` | ADMIN list of every profile (online only) |
| `components/alumni/{alumni-avatar,alumni-text,badges,text-dialog,not-found-state,use-alumni-format}.tsx` | Shared pieces (initials, plain text with links, pills, reply / reason dialog, dates) |
| `lib/alumni/types.ts` | API shapes, limits (same as the backend models), runtime checks, `emptyProfile()` |
| `lib/alumni/filters.ts` | URL state: tabs (`?tab=`), directory filters, `#mentoring` |
| `lib/alumni/paths.ts` | Web pages, API paths, offline query keys (`alumni:*`) |
| `lib/alumni/validation.ts` | Form checks shared by the browser and the Server Actions |
| `lib/alumni/client.ts` | `useLocationSearch` / `useLocationHash` / `replaceSearch`, `useFacets`, `usePrograms`, `usePendingMenteeCount`, `useLiveQuery` |
| `messages/{en,fr}/alumni.json` | Namespace `alumni` (same keys in both files; French uses "tu") |

## Pages

### `/dashboard/alumni` (every role)

h1 "Alumni network". ALUMNI also get a "My alumni profile" link. Tabs (Radix, `role="tablist"` "Alumni network
sections", `[data-tab]`): **Directory**, **News**, **My mentoring** (STUDENT) and **All profiles** (ADMIN). The tab and
the directory filters live in the address and are replaced without a server round trip:
`?tab=news|mentoring|support&q&program&promotion&sector&skill&mentoring=true&sort=name|recent|promotion`. Notification
links `/dashboard/alumni#mentoring` open "My mentoring" and scroll to `section#mentoring`.

- **Directory**: search form (`role="search"`, "Search"; every word must match, case and accents ignored), selects
  "Program", "Graduation year", "Sector", "Skill" (options from `GET /alumni/facets` with counts, "Python (3)"),
  "Sort by" ("Name", "Recently updated", "Graduation year"), checkbox "Mentoring available only" (with "6 alumni are
  open to mentoring."), "Reset filters". Count `[data-testid="alumni-count"]` ("7 alumni profiles"). Cards
  `article[data-alumni-id][data-mentoring]` whose name (h3) links to the profile (the whole card is clickable):
  headline (or the job), job line when it says something else, program code + "Class of 2019", city, the first 4
  skills (the filtered one highlighted), sector and "Open to mentoring". Pages of 12 with "Load more".
- **News**: "News from the alumni", filter "Type" (and "Show": all / visible / hidden posts for ADMIN), count
  `[data-testid="posts-count"]`, posts `article[data-post-id][data-type][data-hidden]`: author (link to the profile
  when it can be opened), headline, date, type pill, body `[data-testid="post-body"]` (plain text), "Open the link
  (example.com)" (new tab, `rel="noopener noreferrer nofollow ugc"`). ALUMNI: "Share news" (`aria-expanded`) opens the
  composer ("Type", "Message" 10–2000, "Link (optional)" https — a missing `https://` is added). Author: "Delete";
  ADMIN: "Hide" (dialog, "Reason (optional, shown to the author)") / "Unhide" and "Delete" (audited by the API).
  Hidden posts show `[data-testid="hidden-notice"]` with the reason. Pages of 10.
- **My mentoring** (STUDENT): "How mentoring works" (`[data-testid="mentoring-rules"]`: 4 steps, "Up to 3 pending
  requests at a time, and one per alumni."), group "Show" ("Active" = pending + accepted, "Past", "All",
  `aria-pressed`), `[data-testid="pending-count"]` ("2 of 3 pending requests"), requests
  `article[data-request-id][data-status]` (see below). Empty: "Find a mentor" switches to the directory filtered on
  "Mentoring available only".
- **All profiles** (ADMIN): every profile, PRIVATE ones included (`GET /alumni/admin/profiles`), "Search profiles",
  "Visibility", "Mentoring", rows `article[data-profile-id][data-listed]` with "Visible to the campus" / "Private" and
  "In the directory" / "Not in the directory". Read online only (`useLiveQuery`): private profiles are never saved in
  IndexedDB.

### `/dashboard/alumni/[id]` (every role; `id` = profile id or user id)

"Back to the alumni network", h1 = name, headline, "Open to mentoring", facts (`<dl>`: "Job", "Program", "Graduation
year", "Sector" — a link to the directory filtered by it —, "City", "LinkedIn" in a new tab), "Profile updated on …",
"About" (bio as plain text), "Skills" (links "Find alumni skilled in React" → `?skill=`), "Latest news from Selim" (3
posts, read only). Unknown, private (for others) or erased profiles → "This profile isn't available."
(`[data-testid="alumni-not-found"]`). The owner and ADMINs also see a PRIVATE profile, with
`[data-testid="private-notice"]`; the owner gets "Edit my profile".

The **Mentoring** panel (first on phones, right column on large screens) lists the alumni's topics, then:

- STUDENT (`AskMentoring`): the rules box and "You have 2 of 3 pending requests.", then "Ask for mentoring"
  (`aria-expanded`) → form "Topic" (2–120, the alumni's topics as `aria-pressed` shortcuts) and "Message" (20–1000,
  live count), a privacy note, "Send request". After sending, or when a request is already PENDING / ACCEPTED, the
  request card is shown in place (with "Withdraw request" / "End mentoring" and, once accepted, the contact), plus
  "See all my mentoring requests". Mentoring off → "Firas isn't taking mentoring requests right now."; 3 pending
  requests → `[data-testid="mentoring-limit"]` and no button; last request declined / closed → a note and the form
  again. Errors of the API are worded for the module (`alumni.errors.*`: `MENTORING_UNAVAILABLE`, `ALREADY_REQUESTED`,
  `MENTORING_LIMIT_REACHED` with its limit, `TOO_MANY_REQUESTS`, profile gone).
- Other roles: "Only students can ask Selim for mentoring." (or "not taking requests"); the owner: what students see.

### `/dashboard/alumni/me` (ALUMNI; other roles are sent to `/dashboard`)

h1 "My alumni profile", "View my profile" once the profile exists. Tabs "Profile", "Mentoring" (badge
`[data-testid="pending-badge"]` with the requests to answer), "My posts", "My data" (`?tab=mentoring|posts|data`;
`#mentoring` from notification links opens the requests).

- **Visibility and consent** (`[data-testid="visibility-card"][data-visibility]`): a profile is private until the
  alumni ticks "I agree that CampusLink shows my alumni profile … to signed-in members of the campus." and clicks
  "Make my profile visible" (`PUT /me { visibility: "CAMPUS", consent: true }`; without the box: "Tick the box to give
  your consent first.", focus on the box; the API's `details.consent` is shown the same way). Visible: the consent
  date and "Make my profile private" (withdraws the consent). The profile form never sends `visibility` / `consent`.
- **Profile form**: fieldsets "Your path" ("Headline", "Job title", "Company", "Sector" with suggestions, "City",
  "Program", "Graduation year" 1950…next year, "LinkedIn profile (optional)" on linkedin.com), "About you" ("About"
  2000, "Skills": chip editor — Enter, a comma or "Add"; "Remove React" buttons; list "Skills list"), "Mentoring"
  (switch "Open to mentoring requests", "Mentoring topics" 2–60 characters, 10 at most). "Save profile" sends every
  field (empty = null); errors under the fields, first one focused; "Your profile is saved." next to the button.
- **Mentoring**: "Mentoring requests received", a notice when mentoring is off (`[data-testid="mentoring-off"]`), the
  same list as the student's with the mentor's actions: "Accept" / "Decline" open a dialog with "Reply (optional)"
  (1000), then "Accept request" / "Decline request"; accepted requests show the student's e-mail
  (`[data-testid="request-contact"]`, `mailto:`) and "End mentoring".
- **My posts**: the wall with `author=me` (hidden posts included, with the moderation reason), "Share news", "Delete".
- **My data**: "Download my data" — a plain `<a href="/bff/alumni/me/export" download>` (the BFF passes
  `Content-Disposition: attachment`, file `campuslink-alumni-data-<date>.json`); "Delete my data": the consequences
  (profile, posts, open requests closed, history anonymized, account kept), then a dialog (`role="alertdialog"`)
  where "Delete my data for good" stays disabled until the user types DELETE (SUPPRIMER in French; case ignored).
  The Server Action checks the word again, then `DELETE /api/alumni/me`; the page shows "Your alumni data was
  deleted. …" and starts again from an empty private profile.

## Requests (`MentoringCard`)

`article[data-request-id][data-status]`: "Request to" / "Request from" + the other person (link to the mentor's
profile when it can be opened; "Deleted profile" once erased), status pill (`[data-request-status]`: "Pending",
"Accepted", "Declined", "Closed"), the topic (heading), "Sent …", "Your message" / "Message from Omar"
(`[data-testid="request-message"]`, "This message was removed." after an erasure), the reply
(`[data-testid="request-reply"]`), the contact while ACCEPTED, and the state ("Waiting for Rania's answer.",
"Accepted on …", "Declined on …", "Closed by you / by Selim / automatically"). Actions: "Accept" / "Decline" (mentor,
PENDING), "Withdraw request" (student, PENDING, confirmation), "End mentoring" (either side, ACCEPTED, confirmation).
An answered or closed request keeps its place with its new status; the pending counts follow. A request answered
meanwhile gives "This request was already answered or closed. …" (`INVALID_STATE`).

## Data, mutations and offline mode

- Every page renders its first data on the server (`serverSnapshot`) and hands it to `useOfflineQuery` (keys
  `alumni:directory:<filters>:<page>`, `alumni:facets`, `alumni:programs`, `alumni:me`, `alumni:profile:<id>`,
  `alumni:mentoring:<role>:<view>:<page>`, `alumni:mentoring:pending`, `alumni:posts:<type>:<author>:<hidden>:<page>:<limit>`):
  no request from the browser when a page loads, and what was opened stays readable offline from IndexedDB ("…isn't
  saved on this device" otherwise). The phase 3 contract does not ask the service worker to save these pages.
- Mutations are Server Actions (`serverApi`), so expected 4xx never reach the browser console; the views update their
  queries with the returned objects (`mutate`) and `invalidateQueries("alumni:…")` refreshes what depends on them.
  Every action is disabled offline with a short explanation.
- Text written by users (bios, posts, messages, replies, reasons) is rendered as text (`AlumniText`: line breaks kept,
  http(s) addresses become links with `rel="noopener noreferrer nofollow ugc"`), never as HTML. E-mail addresses only
  appear in `request.contact` (accepted requests, participants only), as the API returns them.
- One `role="status"` / `role="alert"` at a time inside `<main>`: each tab has one feedback region, shown next to the
  action that produced it (visibility card, form button, list top). Dialogs are portals: their outcome is reported in
  the page.

## Checks

- `npx tsc --noEmit --incremental false`, `npm run lint`, `NEXT_DIST_DIR=.next-alumni npx next build`.
- End-to-end on the production build (real backend + MongoDB, demo seed): STUDENT (directory search, filters, URL
  state after reload, ask with validation and topic shortcut, HTML shown as text, limit of 3, withdraw, unavailable /
  private / invalid profiles, views, news filter, `/me` redirect), ALUMNI (accept and decline with a reply, contact,
  profile form validation and chip editors, consent refused then given, private profile hidden from students, post
  validation / publish / delete, export download parsed, erasure behind the typed word), ADMIN (hidden posts, hide with
  a reason, unhide, audited delete, support list and private profile notice), TEACHER (no ask button, skill links), a
  student ending an accepted mentoring, mentoring-off and private-profile owners; English and French, desktop
  (1366×900) and mobile (390×844), light and dark; no horizontal scroll, console error or CSP violation.

## Known limits

- The directory, the wall and the request lists are not pushed in real time: they refresh on focus and after each
  action (no Socket.IO event is defined for this module).
- Counts in the tab badge and the "pending" lines follow the actions made on this page; requests answered from another
  device appear after the next refresh.
