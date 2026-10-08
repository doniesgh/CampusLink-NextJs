# Notes marketplace — `/api/marketplace` (Module 3)

Phase 3 contract, section 3 ([`docs/phase3-contract.md`](../../docs/phase3-contract.md)). Students and teachers share
course notes, summaries, exercises and slides, free or for fictitious tokens; administrators review every document
before it is published, handle reports and can unpublish. Every user has a token wallet with a ledger.

Code: `models/{marketDocument,marketPurchase,marketReview,marketReport,wallet,walletTransaction}Model.js`,
`service/marketplaceService.js` (visibility, upload and edits, downloads, reviews, reports, moderation, notifications),
`service/walletService.js` (wallets, purchases, ledger, recovery job), `controllers/marketplaceController.js` (HTTP
parsing, validation, audit), `routes/marketplace.js`, seed `scripts/seed/70-marketplace.js`.

Every route needs `Authorization: Bearer` (`401 AUTH_REQUIRED` / `TOKEN_EXPIRED` / `INVALID_TOKEN`). Ids in the path
are checked (`400 INVALID_ID`). Phase 1 conventions apply: `{ error, code, details? }` errors, string `id`, ISO 8601
UTC dates, `{ items, total, page, limit }` pagination (`limit` ≤ 100).

## Who can do what

| Action | STUDENT | TEACHER | ADMIN | ALUMNI |
| ------ | ------- | ------- | ----- | ------ |
| Browse, search, download free documents, buy, review, report, wallet | yes | yes | yes | yes |
| Upload (`POST /documents`) | yes → review queue | yes → review queue | yes → published at once | `403 FORBIDDEN` |
| Edit / delete a document | own documents (rules below) | own | own | own |
| Approve, reject, unpublish, reports queue, delete a review | `403` | `403` | yes | `403` |

The web pages are for STUDENT, TEACHER and ADMIN (contract section 5); the API follows the contract's download rule
("any signed-in user"), so ALUMNI can read and buy but not upload.

## Endpoints

| Endpoint | Who | Answer |
| -------- | --- | ------ |
| `GET /config` | any | `{ startingTokens, minPrice, maxPrice, maxUploadMb, allowedExtensions, allowedMimeTypes, types, statuses }` (for forms) |
| `GET /wallet?page&limit` | any | `{ balance, transactions: [Transaction], total, page, limit }`, newest first (creates the wallet on first use) |
| `GET /documents?q&subject&level&type&professor&academicYear&free&sort&mine&purchased&status&author&page&limit` | any | `{ items: [Document], total, page, limit }` |
| `POST /documents` (multipart `data` + `file`) | STUDENT, TEACHER, ADMIN | `201` Document |
| `GET /documents/:id` | see "Visibility" | Document (+ `canReview`) |
| `PATCH /documents/:id` | author | `200` Document |
| `DELETE /documents/:id` | author | `204` (only when nobody bought it) |
| `GET /documents/:id/file` | see "Downloads" | the file (`Content-Disposition: attachment`) |
| `POST /documents/:id/purchase` `{ expectedPrice? }` | any, not the author | `201 { purchase, balance, document }` |
| `GET /documents/:id/reviews?page&limit` | see "Visibility" | `{ items: [Review], total, page, limit, myReview, canReview, distribution }` |
| `PUT /documents/:id/review` `{ rating, comment? }` | buyer / downloader | `201` Review (created) or `200` (updated) |
| `DELETE /documents/:id/review` | review author | `204` (`404` without a review) |
| `DELETE /reviews/:id` | ADMIN | `204` (moderation, audited) |
| `POST /documents/:id/report` `{ reason }` | any, not the author | `201` Report, or `200` with the user's open report |
| `POST /documents/:id/approve` | ADMIN | `200` Document (`PUBLISHED`) |
| `POST /documents/:id/reject` `{ reason }` | ADMIN | `200` Document (`REJECTED`) |
| `POST /documents/:id/unpublish` `{ reason? }` | ADMIN | `200` Document (`UNPUBLISHED`) |
| `GET /reports?status=OPEN\|RESOLVED&page&limit` | ADMIN | `{ items: [Report (admin)], total, page, limit, openCount }` |
| `POST /reports/:id/resolve` `{ note? }` | ADMIN | `200` Report (admin); already resolved → `409 INVALID_STATE` |

## JSON

```
Document {
  id, title, description, subject: { id, name, code, color } | null, level, academicYear, professor,
  type: "COURSE_NOTES" | "SUMMARY" | "EXERCISES" | "EXAM_PREP" | "SLIDES" | "OTHER",
  file: { filename, size, mimeType }, price (0 = free, tokens), author: { id, firstname, lastname },
  status: "PENDING_REVIEW" | "PUBLISHED" | "REJECTED" | "UNPUBLISHED", rejectionReason, rating, ratingCount,
  downloads, publishedAt, createdAt, updatedAt,
  purchased, mine, canDownload            // viewer fields, every answer
  canReview                               // detail, upload, edit, purchase and moderation answers
}
Review       { id, documentId, author: { id, firstname, lastname }, rating, comment, createdAt, updatedAt, editedAt }
Transaction  { id, type: "STARTING_BONUS" | "PURCHASE" | "SALE", amount (signed), balanceAfter,
               document: { id, title } | null, createdAt }
Purchase     { id, documentId, kind: "PURCHASE", price, state: "PAID" | "COMPLETED", createdAt }
Report (reporter, POST)  { id, documentId, reason, status, createdAt }
Report (ADMIN)           { id, documentId, document: { id, title, status, price, author } | null, reason,
                           status: "OPEN" | "RESOLVED", outcome: "UNPUBLISHED" | "NO_ACTION" | null, note,
                           reporter: { id, firstname, lastname, role }, createdAt, resolvedAt,
                           resolvedBy: { id, firstname, lastname } | null }
```

- `purchased`: the viewer holds a right to the document: bought it (premium) or downloaded it at least once (free).
  `mine`: the viewer is the author. `canDownload`: see "Downloads". `canReview`: see "Reviews".
- `rating` = average of the reviews rounded to 2 decimals (0 without review); `downloads` = distinct users (not the
  author) who downloaded the published document at least once.
- `rejectionReason` is the reason of the last rejection **or unpublication** (only on REJECTED / UNPUBLISHED documents,
  which only their author and ADMINs see); `null` otherwise.
- `publishedAt` = first publication (kept when an unpublished document is published again); `null` before.
- Never sent: the storage key of the file, e-mails, the author's or the buyers' internal data, the counters used for
  concurrency. The wallet history of an author never names the buyer (a sale only names the document), and the sale
  notification does not either. Review authors are public (name only); reporters are only shown to ADMINs.
- `distribution` (reviews) = `{ "1": n, "2": n, "3": n, "4": n, "5": n }`; `myReview` = the viewer's review or `null`.

## Rules

### Upload — `POST /documents`

Multipart: one `file` + a `data` field holding the JSON fields (without `data`, the multipart text fields are read
instead; a JSON body without file → `400 VALIDATION_ERROR`, `details.file`). Malformed `data` → `400 INVALID_JSON`.

| Field | Rule (`400 VALIDATION_ERROR`, every invalid field in `details` at once) |
| ----- | ---------------------------------------------------------------------- |
| `title` | required, 3–150, one line (whitespace runs become one space) |
| `description` | optional, ≤ 3000, plain text (CRLF → LF, line breaks kept, HTML stored and returned as text) |
| `subject` | required, an existing Subject id |
| `level` | optional, integer 1–5 or `null` |
| `academicYear` | optional `"YYYY-YYYY"` (consecutive years), default the current academic year (`APP_TIMEZONE`) |
| `professor` | optional, ≤ 100, one line, `""` / `null` clears it |
| `type` | optional, default `COURSE_NOTES` (case-insensitive) |
| `price` | optional, integer 0–50 (tokens), default 0 |

- **File**: exactly one (`400 TOO_MANY_FILES`), ≤ `MAX_UPLOAD_MB` (`413 FILE_TOO_LARGE`): PDF, PNG, JPEG, WebP, DOCX,
  PPTX; MIME type, extension **and** content (magic bytes) must match (`415 UNSUPPORTED_FILE_TYPE`). Another file
  field → `400 VALIDATION_ERROR`. Saved through `storageService` under `STORAGE_DIR/marketplace/`; the original
  (UTF-8) name is kept for downloads.
- Unknown fields are ignored: no mass assignment of `status`, `author`, `rating`, `downloads`, `file`...
- STUDENT / TEACHER → `PENDING_REVIEW` (the admins are notified, see "Notifications"); ADMIN → `PUBLISHED` at once.

### Visibility

`PUBLISHED` documents are visible to every signed-in user; the others (`PENDING_REVIEW`, `REJECTED`, `UNPUBLISHED`)
only to their author and ADMINs. Anything else answers `404 RESOURCE_NOT_FOUND`, exactly like an unknown id (detail,
file, reviews, purchase, report, edit), so the existence of a hidden document never leaks.

### Edits and deletion

- `PATCH /documents/:id` (author only; ADMINs moderate instead → `403 FORBIDDEN`), same fields and rules as the upload
  (no file: to replace it, delete and upload again). Empty body → `400 NO_CHANGES`.
  - `PENDING_REVIEW`: every field. `REJECTED`: every field, and the document goes back to `PENDING_REVIEW` (reason
    cleared, admins notified): this is the resubmission.
  - `PUBLISHED`: only `price` (anything else would bypass the review) → `409 INVALID_STATE`,
    `details: { status, fields: [...] }`. An ADMIN author may change every field of their own documents.
  - `UNPUBLISHED`: nothing (`409 INVALID_STATE`, except for an ADMIN author).
  - The update is a compare-and-set on the status read: a moderation decision in between → `409 INVALID_STATE`.
- `DELETE /documents/:id` (author only): refused while anybody bought it (`409 IN_USE`,
  `details.references.purchases`) or while a purchase is in progress. Deletes the file, the reviews, the reports and
  the free acquisitions. ADMINs unpublish instead.

### Downloads — `GET /documents/:id/file`

| Document | Who may download (others: `404 RESOURCE_NOT_FOUND`) |
| -------- | ---------------------------------------------------- |
| PUBLISHED, free | every signed-in user |
| PUBLISHED, premium | buyers, the author, ADMINs |
| not published | the author and ADMINs (review) |

- Headers: `Content-Type` = stored MIME type, `Content-Disposition: attachment; filename=...; filename*=UTF-8''...`,
  `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`. A missing file on disk → `404`.
- Counter: the first download of a PUBLISHED document by a user who is not its author increments `downloads` (once
  per user, also under concurrent downloads: conditional update on `firstDownloadAt: null`). Downloading a **free**
  document creates a `FREE` acquisition (`MarketPurchase`, price 0) the first time: it marks it `purchased` and lets
  the user review it. ADMIN downloads of premium documents they did not buy, the author's downloads and `HEAD`
  requests are not counted.

### Wallet and purchases

- Every user gets `MARKET_STARTING_TOKENS` (100) the first time the wallet is used (`GET /wallet`, a purchase, or a
  sale credited to an author), with a `STARTING_BONUS` ledger entry. Concurrent first uses create one wallet and one
  bonus (unique index on `user`, ledger entries with a unique `key`).
- `POST /documents/:id/purchase` `{ expectedPrice? }`: the document must be visible and `PUBLISHED`
  (`404` / `409 INVALID_STATE` with `details.status` for an author or ADMIN looking at a non-published one), not the
  buyer's own (`403 FORBIDDEN`), premium (`409 INVALID_STATE`, `details.reason: "FREE_DOCUMENT"`: download it),
  not already bought (`409 ALREADY_PURCHASED`). `expectedPrice` (integer 0–50, optional): when it differs from the
  current price → `409 PRICE_CHANGED`, `details.price` (the web sends the price it showed, so a buyer is never charged
  more than what they confirmed). Not enough tokens → `409 INSUFFICIENT_TOKENS`, `details: { balance, price }`.
- Success → `201 { purchase, balance, document }`: the buyer is debited, the author credited, two ledger entries
  (`PURCHASE` −price for the buyer, `SALE` +price for the author, each with `balanceAfter`), `MARKETPLACE`
  notification to the author. A purchase is final (no refund); see "Known limitations".

### Reviews

- `PUT /documents/:id/review` `{ rating (integer 1–5), comment (optional, ≤ 1000, plain text) }`: one review per user
  and document, created (`201`) or replaced (`200`, `editedAt` set). Only on a PUBLISHED document (`409
  INVALID_STATE`), not by its author (`403 FORBIDDEN`, `details.reason: "OWN_DOCUMENT"`), and only by a user who
  bought it (premium) or downloaded it (free) (`403 FORBIDDEN`, `details.reason: "NOT_ACQUIRED"`).
- `DELETE /documents/:id/review` removes one's own review; ADMIN `DELETE /reviews/:id` removes any review (audited
  `marketplace.review.delete`). `rating` / `ratingCount` follow every change.
- Comments are stored as text: an aggregation-pipeline upsert wraps user values in `$literal`, so text such as
  `"$set"` is never read as a field path.

### Search — `GET /documents`

| Parameter | Meaning |
| --------- | ------- |
| `q` (≤ 200) | MongoDB text index on `title` (weight 5), `professor` (3), `description` (1), `default_language: "none"` (no stemming nor stop words: French and English behave the same; case and diacritics ignored); `$text` syntax (`"exact phrase"`, `-excluded`) |
| `subject` | Subject id |
| `level` | integer 1–5 |
| `type` | one document type (case-insensitive) |
| `professor` (≤ 100) | case-insensitive "contains" |
| `academicYear` | `"YYYY-YYYY"` |
| `free` | `true` (price 0) / `false` (premium) |
| `sort` | `recent` (default; `relevance` by default with `q`), `rating` (then `ratingCount`), `popular` (`downloads`, then rating), `relevance`, `oldest` (creation, for the review queue) |
| `mine=true` | the viewer's documents in every status (`status` filters them); `recent` = newest upload first |
| `status` | comma list of statuses: ADMIN (review queue `?status=PENDING_REVIEW&sort=oldest`), or with `mine=true`; otherwise `403 FORBIDDEN` |
| `purchased=true` | documents the viewer bought or downloaded (published ones) |
| `author` | documents of one author (published ones) |

Without `mine` / `status`, only `PUBLISHED` documents are listed. Booleans accept `true` / `false` only; repeated
parameters and bad values → `400 VALIDATION_ERROR` (`details.<param>`).

### Moderation

- `approve`: `PENDING_REVIEW` → `PUBLISHED`, and `UNPUBLISHED` → `PUBLISHED` (published again, first `publishedAt`
  kept). `reject` (`reason` 3–500, required): `PENDING_REVIEW` → `REJECTED`. `unpublish` (`reason` ≤ 500, optional):
  `PUBLISHED` → `UNPUBLISHED`, and every open report of the document is resolved (`outcome: "UNPUBLISHED"`).
- Each decision is a compare-and-set on the status read (`findOneAndUpdate({ _id, status })`): two admins deciding at
  once → one wins, the other gets `409 INVALID_STATE` with `details.status` (current status). Any other starting
  status → `409 INVALID_STATE`.
- Reports (`reason` 5–500): only on PUBLISHED documents the reporter can see, not one's own (`403`). One open report
  per user and document (unique partial index; reporting again, even concurrently, returns it with `200`). After a
  resolution the user may report again. Resolve (`note` ≤ 500): `outcome` is `UNPUBLISHED` when the document is
  unpublished at that time, else `NO_ACTION`.
- Audit (`targetType: "MarketDocument"`, `metadata: { authorId, title, price, ... }`): `marketplace.approve`
  (`previousStatus`), `marketplace.reject` (`reason`), `marketplace.unpublish` (`reason`, `resolvedReports`); and
  `marketplace.review.delete` (`targetType: "MarketReview"`, `metadata: { documentId, authorId, rating }`).

### Notifications (`type: "MARKETPLACE"`, in-app + push, recipient's locale, French uses "tu")

| When | Who | Title (fr / en) | Body | `data.kind` |
| ---- | --- | --------------- | ---- | ----------- |
| upload or resubmission by a non-admin | every ADMIN except the author, **at most once per author every 10 minutes** (the other documents wait in the queue) | `Nouveau document à vérifier : « <title> »` / `New document to review: "<title>"` | `<Name> a proposé un document pour la marketplace.` | `REVIEW_REQUEST` |
| approved (or published again) | author | `Ton document est publié : « <title> »` / `Your document is published: "<title>"` | `Il est maintenant visible dans la marketplace.` | `PUBLISHED` |
| rejected | author | `Ton document a été refusé : « <title> »` / `Your document was rejected: "<title>"` | `Motif : <reason>. Tu peux le modifier et le proposer à nouveau.` | `REJECTED` |
| unpublished | author | `Ton document a été retiré : « <title> »` / `Your document was unpublished: "<title>"` | `Motif : <reason>` (or a generic sentence) | `UNPUBLISHED` |
| sold | author | `Nouvelle vente : « <title> »` / `New sale: "<title>"` | `Quelqu’un a acheté ton document : +<n> jetons.` (the buyer is not named) | `SALE` |

`data = { kind, documentId, ... }` (`status` for decisions, `price` for sales). Links: `/dashboard/marketplace/<id>`
for authors, `/dashboard/admin/marketplace?document=<id>` for the review request. Push tags:
`marketplace-review-queue` (a new request replaces the previous push), `marketplace-document-<id>`,
`marketplace-sale-<id>`.

### Rate limits (`userRateLimit`, per user, in memory, skipped with `RATE_LIMIT_ENABLED=false`)

| Route | Limit per `RATE_LIMIT_MARKET_WINDOW_MS` (default 1 h) | Who |
| ----- | ----------------------------------------------------- | --- |
| `POST /documents` | `RATE_LIMIT_MARKET_UPLOAD_MAX` (10) | STUDENT, TEACHER (ADMINs are not limited) |
| `POST /documents/:id/report` | `RATE_LIMIT_MARKET_REPORT_MAX` (20) | everyone except ADMINs |

Counted on every request that reaches the limiter (refused ones too); the upload limiter runs before the multipart
body is read. Over the limit → `429 TOO_MANY_REQUESTS`, `Retry-After` header and `details.retryAfter` (seconds).

## Concurrency (no transactions: MongoDB without replica set)

A purchase is a sequence of atomic single-document steps, each idempotent (`service/walletService.js`):

1. **Reservation of the document**: `purchasesInFlight + 1` only if it is still `PUBLISHED` and not being deleted
   (released at the end, success or failure). Deleting needs `purchasesInFlight = 0` and sets `deleting`, which no
   new purchase accepts: a purchase and a deletion never both succeed.
2. **Conditional debit with a hold**: `findOneAndUpdate({ user, balance ≥ price, no hold for this document },
   { $inc: { balance: −price }, $push: { pending: { op, kind: DEBIT, document, amount, at } } })`. The balance can
   never go below 0, and parallel duplicates of the same purchase never hold the tokens twice (the losers get
   `ALREADY_PURCHASED`, not a wrong `INSUFFICIENT_TOKENS`).
3. **Unique purchase** `MarketPurchase { _id: op, buyer, document, state: PENDING }`, unique `(buyer, document)`: a
   duplicate key refunds the hold (conditional `$pull` + `$inc`, so a refund happens at most once) →
   `409 ALREADY_PURCHASED`. **Never a double charge.**
4. **Confirmation** of the hold (only an unconfirmed hold is ever refunded) and `state: PAID` (access granted).
5. **Completion**: ledger `PURCHASE` (key `purchase:<op>`), author credit `findOneAndUpdate({ user: author,
   pending.op ≠ op }, { $inc: +price, $push: { op, kind: CREDIT } })` → credited **exactly once**, ledger `SALE`
   (key `sale:<op>`), `state: COMPLETED`, `sales + 1`, notification, buyer hold removed. The author's CREDIT marker is
   kept until the job removes it (purchase completed for longer than `MARKET_HOLD_TIMEOUT_MS`), so even a late second
   completion cannot credit twice. Ledger entries are upserts on a unique `key`.

**Recovery job** `marketplace.purchases-recover` (every `max(SCHEDULER_INTERVAL_MS, 5 s)`), for what an interrupted
request left behind once older than `MARKET_HOLD_TIMEOUT_MS` (2 min): a hold without purchase → refunded; a `PENDING`
purchase → hold refunded and purchase dropped (or completed when the hold was confirmed); a `PAID` purchase →
completed (ledger, author credit); old CREDIT markers → removed. A request stalled longer than the timeout after
its debit sees its hold refunded, drops its purchase and answers `409 INVALID_STATE` ("try again").

Other cases: reviews (atomic upsert returning the previous rating, then `$inc`-like pipeline update of `ratingSum`,
`ratingCount` and `rating` together; concurrent first reviews retry on the duplicate key), downloads (conditional
`firstDownloadAt: null` update), free acquisitions (upsert), reports (unique open report), moderation (compare-and-set
on the status), wallets (unique `user`).

Invariant checked by the smoke test: for every wallet, `balance = Σ ledger amounts ≥ 0`; one purchase per
`(buyer, document)`; `downloads`, `sales`, `ratingCount` / `ratingSum` match the data.

## Models (names are part of the contract)

| Model | Collection | Notes |
| ----- | ---------- | ----- |
| `MarketDocument` | `marketdocuments` | text index (title 5, professor 3, description 1); `file.key` (storage), `authorSnapshot`, moderation fields, counters (`rating`, `ratingSum`, `ratingCount`, `downloads`, `sales`), `purchasesInFlight`, `deleting` |
| `MarketPurchase` | `marketpurchases` | unique `(buyer, document)`; `kind` `PURCHASE` / `FREE`, `state` `PENDING` / `PAID` / `COMPLETED`, `price`, `seller`, `documentTitle`, download fields |
| `MarketReview` | `marketreviews` | unique `(document, author)`, `rating`, `comment`, `editedAt` |
| `MarketReport` | `marketreports` | unique open report per `(reporter, document)`; `outcome`, `note`, `resolvedBy` |
| `Wallet` | `wallets` | unique `user`, `balance` (integer ≥ 0), `pending` (holds and credit markers in progress) |
| `WalletTransaction` | `wallettransactions` | ledger, unique `key`; `type`, signed `amount`, `balanceAfter`, `document`, `documentTitle`, `purchase` |

## Error codes of the module

`VALIDATION_ERROR` (400, `details`), `INVALID_JSON` (400), `INVALID_ID` (400), `NO_CHANGES` (400), `TOO_MANY_FILES`
(400), `AUTH_REQUIRED` / `TOKEN_EXPIRED` / `INVALID_TOKEN` (401), `FORBIDDEN` (403, `details.reason` for reviews),
`RESOURCE_NOT_FOUND` (404), `INVALID_STATE` (409, `details.status` / `details.reason` / `details.fields`), `IN_USE`
(409, `details.references.purchases`), `ALREADY_PURCHASED` (409), `INSUFFICIENT_TOKENS` (409, `details: { balance,
price }`), `PRICE_CHANGED` (409, `details.price`), `FILE_TOO_LARGE` (413), `UNSUPPORTED_FILE_TYPE` (415),
`TOO_MANY_REQUESTS` (429).

## Configuration

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `MARKET_STARTING_TOKENS` | 100 | tokens of a new wallet (0 allowed) |
| `MAX_UPLOAD_MB` | 10 | maximum file size (shared with the other uploads) |
| `RATE_LIMIT_MARKET_UPLOAD_MAX` | 10 | uploads per user and window (ADMINs not limited) |
| `RATE_LIMIT_MARKET_REPORT_MAX` | 20 | reports per user and window |
| `RATE_LIMIT_MARKET_WINDOW_MS` | 3600000 | window of the two limits |
| `MARKET_HOLD_TIMEOUT_MS` | 120000 | age after which the recovery job takes over an unfinished purchase |
| `STORAGE_DIR`, `SCHEDULER_INTERVAL_MS`, `RATE_LIMIT_ENABLED` | | see `backend/README.md` |

## Demo data — `scripts/seed/70-marketplace.js`

12 documents with small generated PDFs (pdfkit, standard Helvetica fonts) in the six demo subjects, French and
English: 10 published (5 free: SQL summary, React course by Karim Trabelsi, ML notes by Leila Gharbi, microservices
slides, Scrum page; 5 premium from 3 to 15 tokens), Nour's document waiting for a review and Rami's rejected one (with
its reason). 17 purchases (ledger entries for the buyer and the author), 25 free downloads, 23 reviews (only by users
who bought or downloaded the document), 2 open reports on the BDD exercises and a resolved one. Counters are computed
from that data and the wallets of the users involved are rebuilt from their ledger (100 starting tokens 31 days ago,
then purchases and sales, `balanceAfter` recomputed), e.g. Yasmine Haddad 157 tokens.

Idempotent: the demo documents (same author and title, or same author and file name) are deleted with their files,
purchases, ledger entries, reviews and reports, then created again. No notification is sent. Run it while the API is
idle (holds of purchases in progress are cleared from the rebuilt wallets).

## Known limitations

- **No refunds**: a purchase is final. When an ADMIN unpublishes a document, its buyers lose access to it until it is
  published again (moderation decisions win; tokens are fictitious). Authors cannot delete a document once bought.
- The recovery job assumes a request never stalls longer than `MARKET_HOLD_TIMEOUT_MS` between its own steps; if one
  did, it is undone consistently (`409 INVALID_STATE`), never charged twice.
- Rate-limit counters are in memory (one set per backend instance), like the other limiters.
- Deleting a user account (`DELETE /api/users/:id`) keeps their documents (author names come from a snapshot) and
  their wallet; sales of a deleted author are no longer credited to anyone.
- Text search has no stemming (`default_language: "none"`, so French and English behave the same): "jointure" does
  not match "jointures".
