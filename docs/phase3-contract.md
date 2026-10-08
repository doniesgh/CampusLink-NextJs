# CampusLink — Phase 3 contract

Scope: **Module 2 (student carpooling with real-time chat)**, **Module 3 (course notes marketplace)** and
**Module 6 (alumni directory and network)**.

Everything in [`phase1-contract.md`](phase1-contract.md) and [`phase2-contract.md`](phase2-contract.md) still
applies (conventions, error shape, auth, roles, pagination, campus timezone, i18n FR "tu"/EN, BFF, offline data
layer, file ownership rules, client-agnostic API for the future Flutter app). Read [`architecture.md`](architecture.md),
`backend/README.md`, `backend/docs/*.md`, `next/README.md` and `next/docs/*.md` first and **reuse the existing
services** (`requireAuth`/`requireRole`, `auditService.record`, `notificationService.notifyUsers`, `pushService`,
`storageService` + upload middleware, `scheduler.registerJob`, `userRateLimit`, validation helpers, seed plugins;
web: `serverApi`, `requireRole`, `useOfflineQuery`, `queueMutation`, the BFF, UI primitives, `lib/datetime`).

---

## 0. Shared changes (done by the lead before the module agents start)

- Notification `type` enum gains `CARPOOL`, `MARKETPLACE`, `MENTORING`.
- Stub routers mounted in `backend/app.js`: `routes/carpool.js` → `/api/carpool`, `routes/marketplace.js` →
  `/api/marketplace`, `routes/alumni.js` → `/api/alumni`, `routes/realtime.js` → `/api/realtime`.
- `backend/service/realtime.js` stub (no-op `init(server)`, `emitToUser`, `emitToRoom`,
  `registerRoomAuthorizer`), already called by `app.js` after `listen` with the HTTP server.
- Dependencies installed: `socket.io` (backend), `socket.io-client` (web).
- Web: CSP `connect-src` also allows `NEXT_PUBLIC_REALTIME_URL` (default `http://localhost:4000`, http(s) and
  ws(s)); `Permissions-Policy` allows `geolocation=(self)`.
- Navigation, placeholder pages and the `carpool`, `marketplace`, `alumni` message files exist (§4).
- New Mongoose model names: `Trip`, `TripRequest`, `TripMessage`, `TripRating`, `MarketDocument`,
  `MarketPurchase`, `MarketReview`, `MarketReport`, `Wallet`, `WalletTransaction`, `AlumniProfile`,
  `MentoringRequest`, `AlumniPost`.

- Audit action codes (labels already in the audit log page): `carpool.trip.cancel`, `marketplace.approve`,
  `marketplace.reject`, `marketplace.unpublish`, `alumni.export`, `alumni.erase`, `alumni.post.delete`,
  `alumni.post.hide`.

## 1. Real-time layer — `/api/realtime` + Socket.IO (owned by the carpool backend expert)

- `GET /api/realtime/ticket` (auth) → `{ ticket, url, expiresIn }`: a JWT (HS256, `JWT_SECRET`, audience
  `realtime`, subject = user id, 60 s). `url` = `PUBLIC_API_URL`.
- Socket.IO server on the API's HTTP server (path `/socket.io`, CORS = `CORS_ORIGINS`). Handshake auth:
  `auth.ticket` (web) **or** `auth.token` = access token (Flutter). Invalid/expired → connection refused.
- Each socket joins `user:<id>`. Client event `room:join` `{ room }` (ack `{ ok, error? }`) — joins only when the
  authorizer registered for the room prefix allows it (`registerRoomAuthorizer('trip', async (user, id) => …)`);
  `room:leave` `{ room }`.
- Server API for modules: `emitToUser(userId, event, payload)`, `emitToRoom(room, event, payload)`.
- `notificationService.notifyUsers` also emits `notification:new` `{ id, type, title }` to each recipient's
  `user:` room (best effort, never throws) — the carpool backend expert adds this two-line hook.
- Single instance only (no adapter): documented limitation.
- Web (owned by the carpool web expert): `lib/realtime/*` — `useRealtimeEvent(event, handler)`,
  `useRealtimeRoom(room)`, a singleton client that fetches `/bff/realtime/ticket`, connects with
  `transports: ["websocket"]`, renews the ticket on reconnect, and stays silent offline.

## 2. Module 2 — Carpooling — `/api/carpool`

Trip JSON:
```
{ id, driver: { id, firstname, lastname, rating, ratingCount }, departure: { label, lat, lng },
  destination: { label, lat, lng }, departureAt, seats, seatsLeft, pricePerSeat, distanceKm,
  preferences: { smoking: false, music: true, pets: false, womenOnly: false }, notes,
  status: "OPEN" | "FULL" | "CANCELLED" | "COMPLETED", myRequest?: { id, status }, createdAt }
```
- **Privacy**: `lat`/`lng` are rounded to 2 decimals (~1 km) for anyone who is not the driver or an accepted
  passenger; exact values only for them.
- Destination defaults to the campus (`CAMPUS_LAT`, `CAMPUS_LNG`, `CAMPUS_LABEL`; default ESPRIT Ghazela
  36.8992, 10.1897). Trips may also go *from* the campus (`direction: "TO_CAMPUS" | "FROM_CAMPUS"`).
- Rules: departure in the future (≤ 30 days), 1–6 seats, `pricePerSeat` 0–20 (DT) — the web suggests the
  shared cost: `distanceKm × CARPOOL_COST_PER_KM (0.25) / (seats + 1)`; `distanceKm` = haversine × 1.3.
  STUDENT only (403 otherwise). A driver has at most 5 upcoming OPEN/FULL trips.
- **Search**: `GET /api/carpool/trips?lat&lng&radiusKm(≤ 20, default CARPOOL_SEARCH_RADIUS_KM=5)&from&to&direction&seats`
  → OPEN trips whose departure (or arrival for FROM_CAMPUS) is within the radius (`2dsphere` index, `$geoNear`),
  sorted by distance then time, with `distanceFromYouKm`. Without lat/lng: upcoming trips sorted by time.
- `POST /api/carpool/trips`, `GET /api/carpool/trips/:id`, `PATCH /api/carpool/trips/:id` (driver; seats ≥ accepted
  passengers; time changes notify passengers), `POST /api/carpool/trips/:id/cancel` (driver → notifies passengers).
- **Requests**: `POST /api/carpool/trips/:id/requests` `{ seats: 1-3, message? }` (not the driver, one active
  request per trip, 409 `TRIP_FULL` / `ALREADY_REQUESTED`); driver `POST /api/carpool/requests/:id/accept|decline`
  (atomic seat decrement — never overbook, 409 `TRIP_FULL`); passenger `POST /api/carpool/requests/:id/cancel`.
  `CARPOOL` notifications (localized) at each step.
- **Chat**: `GET /api/carpool/trips/:id/messages?before&limit` and `POST /api/carpool/trips/:id/messages`
  `{ body (1–1000), clientRequestId? }` — only the driver and accepted passengers (403 otherwise); persisted, then
  emitted as `chat:message` to room `trip:<id>`; idempotent with `clientRequestId`. Rate limit 30 messages/min.
- **Ratings** after the trip (departure + 1 h passed, trip not cancelled): each participant rates the others once
  (1–5 + comment ≤ 300) → `TripRating`; user rating = average, shown on trips.
- `GET /api/carpool/me/trips?role=driver|passenger&scope=upcoming|past` (history) — a job marks past trips
  `COMPLETED`.
- Points list for the web picker: `GET /api/carpool/places` → curated Greater Tunis places `{ label, lat, lng }`
  (Ariana, La Marsa, Ennasr, Lac 2, Bardo, Menzah, Manouba, Ben Arous, Centre-ville, Raoued, …).
- Audit: `carpool.trip.cancel` (by admin), admin can cancel any trip (`POST .../cancel` as ADMIN).

## 3. Module 3 — Notes marketplace — `/api/marketplace`

MarketDocument JSON:
```
{ id, title, description, subject: { id, name, code, color }, level, academicYear, professor, type:
  "COURSE_NOTES" | "SUMMARY" | "EXERCISES" | "EXAM_PREP" | "SLIDES" | "OTHER", file: { filename, size, mimeType },
  price (0 = free, tokens), author: { id, firstname, lastname }, status: "PENDING_REVIEW" | "PUBLISHED" |
  "REJECTED" | "UNPUBLISHED", rejectionReason, rating, ratingCount, downloads, purchased?, createdAt }
```
- Upload (STUDENT, TEACHER, ADMIN): multipart `data` + one `file` (PDF, images, PPTX, DOCX; ≤ `MAX_UPLOAD_MB`),
  price 0–50 tokens → `PENDING_REVIEW` (ADMIN uploads are published directly). **Moderation**: ADMIN approves or
  rejects (reason required) → `MARKETPLACE` notification; reports on published documents (reason) → admin queue;
  admin unpublishes. Audited `marketplace.approve|reject|unpublish`.
- **Wallet** (fictitious tokens): every user gets `MARKET_STARTING_TOKENS` (100) on first use. `GET /api/marketplace/wallet`
  → `{ balance, transactions: [...] }`. **Purchase** `POST /api/marketplace/documents/:id/purchase` (published, not
  the author, not already bought): atomic conditional debit (`balance >= price`), unique `MarketPurchase`
  `(buyer, document)` (duplicate → refund, 409 `ALREADY_PURCHASED`), credit the author, ledger entries
  (`WalletTransaction`), 409 `INSUFFICIENT_TOKENS`. Never a negative balance, never a double charge.
- **Download** `GET /api/marketplace/documents/:id/file`: free and published → any signed-in user; premium →
  buyer, author or ADMIN only (404 otherwise, never 403 leaking existence of hidden documents); counts downloads.
- **Reviews**: users who downloaded (free) or bought (premium) rate once (1–5 + comment ≤ 1000), editable;
  `rating` = average. Authors cannot review their own documents.
- **Search**: `GET /api/marketplace/documents?q&subject&level&type&professor&academicYear&free=true|false&sort=recent|rating|popular`
  (text index on title, description, professor). Authors and admins also see their non-published documents
  (`?mine=true`, admin `?status=`).
- Rate limit uploads (10/h per user) and reports.

## 4. Module 6 — Alumni directory and network — `/api/alumni`

AlumniProfile JSON: `{ id, user: { id, firstname, lastname }, program: { id, name, code } | null, promotion
(graduation year), headline, bio, skills, company, jobTitle, sector, city, linkedinUrl, mentoringAvailable,
mentoringTopics, visibility: "PRIVATE" | "CAMPUS", consentAt, updatedAt }`.
- **Consent (RGPD)**: an ALUMNI profile is visible to others only when `visibility = CAMPUS` with an explicit
  `consentAt`; default PRIVATE. E-mail is never in the profile. `GET /api/alumni/me/export` → JSON of everything
  stored about the alumni (profile, posts, mentoring); `DELETE /api/alumni/me` → deletes profile and posts,
  anonymizes mentoring history (right to be forgotten). Audited `alumni.export|erase`.
- `GET|PUT /api/alumni/me` (ALUMNI). Directory `GET /api/alumni?q&program&promotion&sector&skill&mentoring=true&page`
  (any signed-in user; CAMPUS profiles only), `GET /api/alumni/:id`.
- **Mentoring**: STUDENT `POST /api/alumni/:id/mentoring` `{ topic, message (20–1000) }` (alumni must have
  `mentoringAvailable`; ≤ 3 pending requests per student; one pending per pair) → `MENTORING` notification;
  alumni accepts/declines with an optional reply; **contact is shared only after acceptance** (both e-mails returned
  in the accepted request); either side can close it. `GET /api/alumni/mentoring?role=mentor|mentee&status`.
- **News wall**: `GET /api/alumni/posts?type&page`, ALUMNI `POST /api/alumni/posts` `{ type: "NEW_JOB" |
  "ACHIEVEMENT" | "OPPORTUNITY" | "EVENT" | "OTHER", body (10–2000), link? (https URL) }`, author or ADMIN
  `DELETE /api/alumni/posts/:id` (audited when ADMIN). Rate limit 10 posts/day. Text only, never HTML.
- ADMIN: `GET /api/alumni/admin/profiles` (all, incl. PRIVATE, for support), can hide a post.

## 5. Web app

Namespaces `carpool`, `marketplace`, `alumni` (FR "tu" + EN, complete). Mobile-first, accessible, dark mode.

| Path | Who | Content |
|---|---|---|
| `/dashboard/carpool` | STUDENT | Search (place picker from `/places` or "Use my location" via the browser Geolocation API, radius, date, direction), results with distance/time/seats/price/driver rating, "Offer a trip" form with suggested shared cost, my trips (driver/passenger, upcoming/past) |
| `/dashboard/carpool/[id]` | STUDENT (participants see more) | Trip details, request a seat / manage requests (driver), **real-time chat** (driver + accepted passengers), cancel, rate after the trip |
| `/dashboard/marketplace` | STUDENT, TEACHER, ADMIN | Search and filters, document cards (free/premium, rating, downloads), upload form, my documents, wallet balance + history |
| `/dashboard/marketplace/[id]` | same | Details, buy (tokens) / download, reviews, report |
| `/dashboard/admin/marketplace` | ADMIN | Review queue (approve/reject with reason), reports, unpublish |
| `/dashboard/alumni` | all | Directory (search, filters, mentoring available), news wall, my mentoring requests |
| `/dashboard/alumni/[id]` | all | Alumni profile, "Ask for mentoring" (STUDENT) |
| `/dashboard/alumni/me` | ALUMNI | Edit profile, visibility/consent, mentoring availability, export my data, delete my data, my posts, mentoring requests received |

Navigation (added by the lead): STUDENT "Covoiturage / Carpooling", "Marketplace", "Réseau alumni / Alumni network";
TEACHER "Marketplace", "Réseau alumni"; ALUMNI "Réseau alumni" (+ "Mon profil alumni / My alumni profile");
ADMIN "Marketplace", "Réseau alumni" + "Modération marketplace / Marketplace moderation".

## 6. Environment variables (new, backend)

`CAMPUS_LAT=36.8992`, `CAMPUS_LNG=10.1897`, `CAMPUS_LABEL=ESPRIT Ghazela`, `CARPOOL_SEARCH_RADIUS_KM=5`,
`CARPOOL_COST_PER_KM=0.25`, `MARKET_STARTING_TOKENS=100`. Web: `NEXT_PUBLIC_REALTIME_URL=http://localhost:4000`.

## 7. Demo data

Seed plugins: `60-carpool.js` (places, ~10 upcoming trips from several neighbourhoods, requests incl. accepted
ones with a few chat messages, past completed trips with ratings), `70-marketplace.js` (published free and premium
documents with small generated PDFs, one pending review, purchases, reviews, wallets), `80-alumni.js` (6–8
alumni accounts — password `Campus123!` — with CAMPUS profiles in several sectors, mentoring requests in each
state, news posts).

## 8. File ownership (parallel work)

| Owner | Files |
|---|---|
| Backend carpool | `models/trip*.js`, `controllers/carpoolController.js`, `routes/carpool.js`, `service/carpoolService.js`, **`service/realtime.js`, `routes/realtime.js`, `controllers/realtimeController.js`**, the `notification:new` hook in `service/notificationService.js`, `scripts/seed/60-carpool.js`, `docs/carpool.md` |
| Backend marketplace | `models/{marketDocument,marketPurchase,marketReview,marketReport,wallet,walletTransaction}Model.js`, `controllers/marketplaceController.js`, `routes/marketplace.js`, `service/{marketplace,wallet}Service.js`, `scripts/seed/70-marketplace.js`, `docs/marketplace.md` |
| Backend alumni | `models/{alumniProfile,mentoringRequest,alumniPost}Model.js`, `controllers/alumniController.js`, `routes/alumni.js`, `service/alumniService.js`, `scripts/seed/80-alumni.js`, `docs/alumni.md` |
| Web carpool | `app/(back)/dashboard/carpool/**`, `components/carpool/**`, `lib/carpool/**`, **`lib/realtime/**`**, `messages/{fr,en}/carpool.json`, `docs/carpool.md` |
| Web marketplace | `app/(back)/dashboard/marketplace/**`, `app/(back)/dashboard/admin/marketplace/**`, `components/marketplace/**`, `lib/marketplace/**`, `messages/{fr,en}/marketplace.json`, `docs/marketplace.md` |
| Web alumni | `app/(back)/dashboard/alumni/**`, `components/alumni/**`, `lib/alumni/**`, `messages/{fr,en}/alumni.json`, `docs/alumni.md` |
| Tests | `tests/**` |
