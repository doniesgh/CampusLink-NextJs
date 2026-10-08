# Course notes marketplace — web (Module 3)

Phase 3 contract, sections 3 and 5 ([`docs/phase3-contract.md`](../../docs/phase3-contract.md)). API reference:
[`backend/docs/marketplace.md`](../../backend/docs/marketplace.md). Everything in `next/README.md` still applies (BFF,
offline data layer, Server Actions for mutations that can fail with a 4xx, UI primitives, campus timezone, FR "tu" /
EN messages).

## Files

| Path | Role |
| ---- | ---- |
| `app/(back)/dashboard/marketplace/layout.tsx` | Adds the `marketplace` messages to the Client Components of the marketplace pages |
| `app/(back)/dashboard/marketplace/page.tsx` + `marketplace-view.tsx` | `/dashboard/marketplace`: tabs "Browse" / "My documents" / "Wallet", "Share a document" |
| `app/(back)/dashboard/marketplace/[id]/page.tsx` + `document-view.tsx` | `/dashboard/marketplace/[id]`: details, buy / download, author and ADMIN tools, report, reviews |
| `app/(back)/dashboard/marketplace/actions.ts` | Server Actions: upload, edit, delete, purchase, save / delete my review, report |
| `app/(back)/dashboard/admin/marketplace/{layout,page}.tsx` + `moderation-view.tsx` | `/dashboard/admin/marketplace` (ADMIN): review queue, reports, unpublished documents |
| `app/(back)/dashboard/admin/marketplace/actions.ts` | Server Actions (ADMIN): approve / publish again, reject, unpublish, resolve a report, delete a review |
| `components/marketplace/browse-panel.tsx` | Search, filters (URL state), results grid with "Load more" and offline fallbacks |
| `components/marketplace/document-card.tsx` | One document as a card (`article[data-document-id][data-status][data-price-kind]`) |
| `components/marketplace/document-form.tsx` | Upload and edit form (fields allowed by the status), browser checks |
| `components/marketplace/edit-document-dialog.tsx` | "Edit" dialog of the author |
| `components/marketplace/my-documents.tsx` | "Shared by me" (status filter, reason, edit, delete) and "Bought or downloaded" |
| `components/marketplace/wallet-panel.tsx` | Balance and history |
| `components/marketplace/purchase-panel.tsx` | "Get this document": price, file, "Download" or "Buy for <n> tokens" + confirmation |
| `components/marketplace/reviews-section.tsx` | Average, distribution, "Your review" form, the reviews (ADMIN delete) |
| `components/marketplace/{badges,rating-stars,market-text,text-dialog,use-market-format}.tsx` | Pills, stars (display and input), plain-text renderer, reason dialog, formatting hooks |
| `lib/marketplace/types.ts` | API shapes, limits (same as the backend models), accepted files, runtime checks |
| `lib/marketplace/filters.ts` | URL state (`tab`, filters, `view`, `status`, `upload`), offline filtering and sorting |
| `lib/marketplace/paths.ts` | Web pages, API paths, offline query keys (`marketplace:*`), page sizes |
| `lib/marketplace/validation.ts` | Form checks shared by the browser and the Server Actions |
| `lib/marketplace/queries.ts` | `useMarketSubjects`, `useMarketConfig`, `useWallet` (offline-first reads) |
| `lib/marketplace/server.ts` | Server only: localised failures of the marketplace API (`marketFailure`, `marketValidationFailure`) |
| `messages/{en,fr}/marketplace.json` | Texts (FR "tu"); same keys in both files |

## `/dashboard/marketplace` (STUDENT, TEACHER, ADMIN; ALUMNI are sent to `/dashboard`)

h1 "Course marketplace". Header: the balance button (`[data-testid=header-balance]`, "157 tokens", accessible name
"Your wallet: 157 tokens", opens the "Wallet" tab) and "Share a document" (`aria-expanded`, opens
`#share-document-panel` and focuses "Title"; `?upload=1` opens it on load without moving the focus). One page feedback
(`role=status` / `role=alert`) under the header.

URL state (History API, no server round trip): `?tab=browse|mine|wallet`, the filters of "Browse"
(`q`, `subject`, `type`, `level`, `price=free|premium`, `professor`, `year`, `sort=relevance|recent|rating|popular`),
"My documents" `view=shared|library` and `status`, and `upload=1`. The server renders the first page of the tab in the
address, the wallet, the subjects and `GET /marketplace/config`, so the page makes no API request when it loads.

Tabs (Radix, `tablist` "Marketplace sections"; only the active tab is mounted; icons hidden on phones):

- **Browse** — `form[role=search]` with the searchbox "Search" and "Search"; filters "Subject", "Type", "Level",
  "Price" ("Free" / "Premium (tokens)"), "Academic year" (current year and the 4 previous ones), "Professor" (applied
  while typing, 450 ms debounce), "Sort by" ("Best match" only with a search, "Newest", "Best rated", "Most
  downloaded"); "Reset filters" when a filter is set. On phones the filters fold under a "Filters (n)" button
  (`aria-controls=market-filters`). Results: "<n> documents" (`[data-testid=market-count]`), cards in a grid (1 / 2 / 3
  columns), pages of 12 with "Load more". Each card (`document-card.tsx`) links its title to the document (the whole
  card is clickable) and shows the type, "Free" / "<n> tokens" (`[data-price]`), subject (`[data-subject=<code>]`),
  level, status when not published, "Your document" / "In your library", the professor, a 2-line excerpt, the rating
  (stars + "4.5 (12)", one accessible name "Rated 4.5 out of 5, 12 reviews", or "No reviews yet"), "<n> downloads",
  "Shared by <name> · <date>".
- **My documents** — group "Show" with "Shared by me" / "Bought or downloaded" (`aria-pressed`). "Shared by me": select
  "Status" (all, "Waiting for review", "Published", "Rejected", "Unpublished"), "<n> documents shared"
  (`[data-testid=mine-count]`); each card has its status, the reason of a rejection / unpublication
  (`[data-testid=rejection-reason]`) with "Edit it … it goes back to the review queue", and the actions "Open the
  file", "Edit" (dialog "Edit your document": every field while it waits for a review or after a rejection —
  "Save and resubmit" —, only "Price in tokens" once published, nothing once unpublished; an ADMIN author edits
  everything) and "Delete" → "Delete "<title>"?" (which warns that a bought document can't be deleted) → "Confirm
  delete" (`IN_USE`: "Someone already bought this document, so it can't be deleted."). "Bought or downloaded": the
  library (`purchased=true`) with "Download". The cards of both lists leave out the "Your document" / "In your
  library" pills (every card is one of those there).
- **Wallet** — "Your balance" (`[data-testid=wallet-balance][data-balance]`) with how tokens work (starting tokens from
  the config), "History": one `li[data-transaction-id][data-type=STARTING_BONUS|PURCHASE|SALE]` per movement
  ("Welcome tokens", "Purchase", "Sale"), the document link, the date, the signed amount (`[data-amount]`, green /
  red, with "Received" / "Spent" for screen readers) and "Balance: <n> tokens"; pages of 20 with "Load more".

**Share a document** (`document-form.tsx`, Server Action `uploadDocumentAction`): "Title" (3–150), "Description
(optional)" (≤ 3000), "Subject", "Type", "Level (optional)", "Academic year" (current by default), "Professor
(optional)", "Price in tokens" (0–50, "0 = free"), "File" (PDF, PNG, JPG, WebP, DOCX, PPTX, up to `maxUploadMb` of the
config). Errors are shown under the fields and summed up in the page alert; the first invalid field is focused. The
form is multipart through the Server Action (`data` JSON + `file`; a missing or generic MIME type is replaced by the
extension's, the API checks the content). Students and teachers: "Send for review" → "Your document was sent for
review. …" and the "My documents" tab; ADMIN: "Publish" (published at once). The filters of "Browse" pre-fill subject,
type and level.

## `/dashboard/marketplace/[id]` (STUDENT, TEACHER, ADMIN)

"Back to the marketplace", type / price / subject / status pills, h1 = title
(`[data-testid=document-title]`), rating and downloads. Then (phones: first; wide screens: right column, sticky):

- **Get this document** (`purchase-panel.tsx`): the price (`[data-testid=document-price]`), the file (name, type,
  size), then
  - "Download" (`<a download href="/bff/marketplace/documents/<id>/file">`) when `canDownload` (free, bought, mine,
    ADMIN), with "You bought this document." / "It's in your library." / "This is your document." / "Admin access: …"
    (`[data-testid=ownership]`). A first download of a free document makes it acquired: the document and its reviews
    are fetched again 1.5 s after the click, so "Your review" appears;
  - otherwise "Buy for <n> tokens" with "You have <n> tokens." — disabled with "You have 3 and need 2 more tokens. …"
    when the balance is too low. The confirmation dialog "Buy this document?" lists "Price", "Your balance now", "After
    the purchase" (`[data-testid=balance-after]`) and "Purchases are final: tokens aren't refunded."; "Confirm
    purchase" sends `expectedPrice` (the price shown). Success → "Purchase confirmed: the document is yours. You have
    <n> tokens left." (balance updated everywhere). `PRICE_CHANGED` → alert in the dialog, the document is reloaded so
    the dialog shows the new price; `ALREADY_PURCHASED` / unavailable → the dialog closes, the page explains and
    reloads; `INSUFFICIENT_TOKENS` → "You don't have enough tokens: …".
- **Actions** (group "Document actions"): the author's "Edit" + "My documents"; "Report" for others (not ADMINs) —
  dialog "Report this document", "Reason" (5–500), "Send report" → "Thanks: an admin will look at your report.";
  ADMIN: "Approve" / "Reject" (pending), "Unpublish" (published, optional reason), "Publish again" (unpublished).
- Facts (level, academic year, professor), "Shared by <name> · <date>", status notice for documents that are not
  published (`[data-testid=status-notice]`, with the reason), "About this document" (plain text, line breaks kept).
- **Reviews**: average with the 5→1 distribution (when there are reviews; each bar is that rating's share of all the
  reviews, the counts are text), then "Your review" for users who
  downloaded (free) or bought (premium) it — fieldset "Your rating" (5 native radios drawn as stars, "4 stars out of
  5"), "Comment (optional)" (≤ 1000), "Publish my review" / "Update my review", "Delete my review" (confirmation);
  "Download this document to leave a review." / "Buy this document to leave a review." otherwise; "You can't review
  your own document." for the author. Reviews are `article[data-review-id][data-rating]` (stars, name, date,
  "edited", comment as plain text, "Your review"), pages of 10 with "Load more"; ADMINs get "Delete" (confirmation).
  Outcomes of this section are shown inside it (the page keeps one `role=status` / `role=alert` in `<main>`).

Unknown, invalid, deleted or hidden documents (another user's pending / rejected / unpublished one) all render the
same h1 "This document isn't available." (`[data-testid=document-not-found]`): nothing leaks.

## `/dashboard/admin/marketplace` (ADMIN; other roles are sent to `/dashboard`)

h1 "Marketplace moderation", `nav` "Moderation sections" with links "To review (<n>)", "Reports (<open>)",
"Unpublished" (`?tab=queue|reports|unpublished`, `aria-current`), server-rendered with server pagination (20 per page);
the Server Actions call `refresh()`.

- **To review** (`?status=PENDING_REVIEW&sort=oldest`): "<n> documents to review" (`[data-testid=queue-count]`); each
  `article[data-document-id][data-status]` shows type, price, subject, level, title (link), "Submitted by <name> ·
  <date>", professor, year, the description, the file and "Open the file" (download through the BFF), "Approve" and
  "Reject" (dialog "Reject this document", required "Reason (shown to the author)" 3–500, "Reject document").
  `?document=<id>` (link of the review-request notification) highlights that document (`[data-highlighted=true]`,
  "From your notification", scrolled into view and focused); a document already handled is shown on top with "This
  document was already handled: <status>." (`[data-testid=notified-document]`).
- **Reports**: "Open" / "Resolved" (`&status=RESOLVED`), "<n> open reports" (`[data-testid=open-reports]`); each
  `article[data-report-id][data-status]`: document status and price, title (link), "By <author>", "Reason", "Reported
  by <name> · <date>"; resolved ones show the outcome (`[data-outcome]`: "Document unpublished" / "No action"),
  "Resolved by <admin>" and "Note: …". Open ones: "Unpublish document" (optional reason; resolves every open report of
  the document) and "Resolve" (dialog "Resolve this report", "Note (optional)", "Resolve report").
- **Unpublished**: the unpublished documents with their reason and "Publish again".

Two admins deciding at once: the slower one gets "Another admin already handled this document (<status>)." and the
lists are rendered again.

## Data, mutations and offline mode

- Reads go through `useOfflineQuery` (keys `marketplace:list:…`, `marketplace:mine:<status>:<page>`,
  `marketplace:library:<page>`, `marketplace:wallet:<page>`, `marketplace:document:<id>`,
  `marketplace:reviews:<id>:<page>`, `marketplace:subjects`, `marketplace:config`), seeded with the server data. The
  marketplace pages are not saved by the service worker (the phase 3 contract asks for no offline mode here), but while
  a page is open the data already loaded stays visible when the connection drops; a filter combination never loaded
  falls back to the saved default list filtered locally ("You're offline: here are the saved documents that match.").
  Buying, reporting, editing and moderating are disabled offline with a short explanation.
- Mutations are Server Actions with `serverApi()` (no failed request in the browser console). Marketplace codes get
  their own wording (`marketplace.errors.*`, `lib/marketplace/server.ts`): `INSUFFICIENT_TOKENS` (`details.balance`,
  `details.price`), `ALREADY_PURCHASED`, `PRICE_CHANGED` (`details.price`), `FORBIDDEN` with `details.reason`
  `NOT_ACQUIRED` / `OWN_DOCUMENT`, `INVALID_STATE` with `details.reason: FREE_DOCUMENT`, `details.fields` (published:
  price only) or `details.status` (moderation race), `IN_USE`, `RESOURCE_NOT_FOUND`, `TOO_MANY_REQUESTS` (uploads,
  reports), `FILE_TOO_LARGE`, `UNSUPPORTED_FILE_TYPE`.
- After a mutation the pages update their queries with the returned data (`mutate`) and revalidate the related lists
  (`invalidateQueries("marketplace…")`): the balance in the header, the library, the lists of "My documents".
- Never HTML: titles, descriptions, reviews, reasons and notes are rendered as text (`MarketText`: line breaks kept,
  http(s) links with `rel="noopener noreferrer nofollow ugc"`).

## Checks

- `npx tsc --noEmit --incremental false`, `npm run lint`, `NEXT_DIST_DIR=.next-marketplace npx next build`.
- End-to-end (production build, real backend on its own MongoDB, demo seed, Playwright scripts outside `tests/`):
  STUDENT, TEACHER and ADMIN, English and French, desktop (1366×900) and phone (390×844), light and dark: every tab,
  the upload panel, document pages and the three moderation sections without console errors, CSP violations or
  horizontal scroll (168 page loads); search and every filter, purchase with the confirmation (balance before / after),
  download, review create / edit / delete with HTML shown as text, report with validation, free download unlocking the
  review, price-only edit of a published document, upload with field errors (type, price, missing fields), edit and
  delete of a pending document, status filter, library, wallet history, resubmission of a rejected document, the
  author's French view of a rejection from the notification link, not enough tokens, price changed while confirming,
  review queue (reject with a reason, approve), notification highlight, reports (unpublish, resolve with a note,
  resolved tab), publish again, ADMIN review deletion and ADMIN upload published at once; ALUMNI and non-admins
  redirected, hidden / unknown documents answered with the same "not available" page.

## Known limits

- Downloads are plain links: the page cannot know when a download finishes, so the "acquired" state of a free document
  is fetched again 1.5 s after the click (and on the next focus of the tab).
- A purchase is final (backend rule): an unpublished document is no longer downloadable by its buyers until it is
  published again.
- The audit log shows `marketplace.review.delete` with its raw code until a label is added to
  `admin.audit.actionLabels` (not a marketplace file).
