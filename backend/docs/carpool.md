# Carpooling — `/api/carpool` (Module 2) and the real-time layer — `/api/realtime` + Socket.IO

Phase 3 contract, sections 1 and 2 ([`docs/phase3-contract.md`](../../docs/phase3-contract.md)). Everything in the
phase 1 conventions still applies: `{ error, code, details? }` errors, string `id`, ISO 8601 UTC dates,
`{ items, total, page, limit }` pagination, campus timezone `APP_TIMEZONE` (default `Africa/Tunis`).

| File | Role |
| ---- | ---- |
| `service/realtime.js` | Socket.IO server: handshake (ticket or access token), sockets bound to login sessions, user rooms, room authorizers, `emitToUser` / `emitToRoom` / `removeUserFromRoom` / `disconnectUser`, 60 s connection check, shutdown |
| `controllers/realtimeController.js`, `routes/realtime.js` | `GET /api/realtime/ticket` |
| `service/notificationService.js` | hook: every new notification is also emitted as `notification:new` (best effort) |
| `models/tripModel.js` | `Trip` (+ `serializeTrip`) |
| `models/tripRequestModel.js` | `TripRequest` (+ `serializeTripRequest`) |
| `models/tripMessageModel.js` | `TripMessage` (+ `serializeTripMessage`) |
| `models/tripRatingModel.js` | `TripRating` (+ `serializeTripRating`) |
| `service/carpoolService.js` | rules, privacy, search, seat accounting, requests, chat, ratings, history, completion job, notifications, `trip` room authorizer |
| `controllers/carpoolController.js`, `routes/carpool.js` | HTTP parsing and validation, audit of admin cancellations |
| `scripts/seed/60-carpool.js` | demo data |

---

## 1. Real-time layer

One Socket.IO server (v4) runs on the API's HTTP server (same host and port), path **`/socket.io`**. It is started
by `app.js` (`realtime.init(server)` after `listen`). Clients only ever receive events; they send nothing but
`room:join` / `room:leave`.

### Ticket — `GET /api/realtime/ticket` (any signed-in user)

```json
{ "ticket": "eyJhbGciOiJIUzI1NiIs…", "url": "http://localhost:4000", "expiresIn": 60 }
```

- A JWT (HS256, audience `realtime`, issuer `campuslink`, subject = user id, unique `jti`, `sid` = the caller's login
  session, copied from the access token's `sid` claim when it has one) valid **60 seconds** and **usable once** (a
  second handshake with the same ticket is refused). `url` = `PUBLIC_API_URL`.
- It is signed with a key derived from `JWT_SECRET` (`HMAC-SHA256(JWT_SECRET, "campuslink:realtime-ticket:v1")`),
  never with `JWT_SECRET` itself: the REST API refuses a ticket used as an access token (`401 INVALID_TOKEN`), so a
  ticket handed to browser JavaScript is only good for one Socket.IO handshake.
- An access token whose session has already ended (logout, password change or reset, …) but has not expired yet
  gets `401 INVALID_TOKEN` (the web client then stops trying until the next login).
- `Cache-Control: no-store`. Limited to `RATE_LIMIT_REALTIME_TICKET_MAX` (60) per minute and user (`429`).

### Handshake

The credential travels in the `auth` payload of the Socket.IO CONNECT packet (never in the URL, never a cookie):

| `auth` | Who | Check |
| ------ | --- | ----- |
| `{ ticket }` | web app (the browser has no access token: it gets a ticket through `/bff/realtime/ticket`) | signature, audience, expiry, single use, user exists, its session (`sid`) still open |
| `{ token }` | other clients (Flutter): the REST access token, `"Bearer "` prefix optional | same as `requireAuth` (signature, expiry, user exists), and its session (`sid`) still open |

A refused handshake gives the client a `connect_error` whose `message` is `"Authentication failed"` and
`data.code` is `AUTH_REQUIRED` (no credential), `INVALID_TOKEN` (bad, forged, reused ticket, unknown user, session
ended) or `TOKEN_EXPIRED` (refresh the access token / fetch a new ticket, then reconnect). `TOO_MANY_CONNECTIONS`
when the user already has 20 sockets.

- **Origins**: a browser's `Origin` must be in `CORS_ORIGINS` (same list as the REST API), checked on the polling
  requests **and** on the WebSocket upgrade (CORS headers alone do not protect WebSockets). Clients that send no
  `Origin` (mobile apps, servers) are accepted.
- **Sessions**: every socket belongs to the login session of its credential (`sid` of the access token or of the
  ticket; none for credentials issued before sessions had ids). An established connection is not cut when its
  access token expires (15 min), but it is **closed by the server** (`disconnect` reason `"io server disconnect"`,
  Socket.IO does not reconnect by itself) as soon as:
  - its session ends: `POST /api/auth/logout` closes the sockets of that session (`tokenService.revokeRefreshToken`);
  - every session of the account ends: password change or reset, password set by an admin, account deletion
    (`tokenService.revokeAllRefreshTokens`) close every socket of the user;
  - the account is deleted or its role changes (`PATCH /api/users/:id`): every socket of the user (the client
    reconnects with a new ticket or token and joins its rooms again under the new role).
  A handshake that was being checked while the account's (or its session's) revocation happened is refused too.
  Safety net: every 60 s, the open sockets whose user no longer exists, whose role changed or whose session ended
  (expired, or revoked by another process such as `npm run create-admin`) are closed; `room:join` checks the same
  (`AUTH_REQUIRED`, then disconnect). Same rule as push: subscriptions are deleted with the sessions.
- Room access is checked again at every `room:join` with the user read from the database.
- Messages sent by clients are limited to 16 KB (`maxHttpBufferSize`); a bigger one closes the connection.

### Rooms and client events

- Every socket joins **`user:<userId>`** automatically (it cannot leave it, and cannot join another user's).
- `room:join` `{ room: "<prefix>:<id>" }` → ack `{ ok: true }` or `{ ok: false, error }`; the room joins only when the
  authorizer registered for the prefix allows it. Errors: `INVALID_ROOM` (malformed name), `UNKNOWN_ROOM` (no
  authorizer for the prefix), `FORBIDDEN`, `TOO_MANY_ROOMS` (50 rooms per socket), `TOO_MANY_REQUESTS` (more than 20
  joins at once, refilled at 2 per second), `INTERNAL_ERROR`, `AUTH_REQUIRED` (account deleted, role changed or
  session ended: the socket is then disconnected). The payload may also be the room string itself.
- `room:leave` `{ room }` → ack `{ ok: true }` (`INVALID_ROOM` for a malformed name).
- Rooms of the carpool module: **`trip:<tripId>`** — the driver and the accepted passengers only.

### Server events

| Event | Room | Payload | When |
| ----- | ---- | ------- | ---- |
| `notification:new` | `user:<id>` | `{ id, type, title }` | every in-app notification created by `notificationService.notifyUsers` (any module) |
| `chat:message` | `trip:<id>` | TripMessage JSON (below) | a new chat message (not on an idempotent replay) |
| `trip:updated` | `trip:<id>` | `{ tripId, status, seats, seatsLeft, departureAt }` | accept, passenger cancellation, trip update or cancellation |
| `carpool:request` | `user:<id>` | `{ tripId, requestId, status }` | to the driver on a new / cancelled request, to the passenger on accept / decline |

`chat:message` is the only event the contract requires from the carpool module; `trip:updated` and
`carpool:request` are optional hints (clients can refresh the trip instead).

### Server API for the modules — `service/realtime.js`

```js
const realtime = require('../service/realtime');
realtime.registerRoomAuthorizer('trip', async (user, id) => isParticipant(user._id, id)); // user = User document
realtime.emitToUser(userId, 'notification:new', payload);  // every socket of the user
realtime.emitToRoom(`trip:${tripId}`, 'chat:message', payload);
realtime.removeUserFromRoom(userId, `trip:${tripId}`);      // access revoked (e.g. a passenger who cancelled)
await realtime.disconnectUser(userId);                      // close every socket of the user
await realtime.disconnectUser(userId, { sessionId });       // only the sockets of one login session
```

All of them never throw and are no-ops before `init` (scripts, seed). `disconnectUser` is already called by
`tokenService` (end of sessions) and `userController` (account deletion, role change); `realtime.issueTicket(user,
sessionId)` and `realtime.isSessionActive(userId, sessionId)` serve the ticket endpoint. Prefixes are lowercase (`[a-z][a-z0-9-]*`),
`user` is reserved. On `SIGINT` / `SIGTERM` the layer disconnects every socket and closes the engine first, so
`app.js`'s `server.close()` can finish (`realtime.close()` does the same on demand).

**Limitation**: a single API instance. Rooms live in memory (no Socket.IO adapter) and the list of used tickets too;
several instances would need the Redis adapter (`@socket.io/redis-adapter`) and a shared store for used tickets.

### Connecting a client

Web (browser, through the BFF):

```js
import { io } from 'socket.io-client';
const socket = io(process.env.NEXT_PUBLIC_REALTIME_URL, {   // or the `url` of the ticket
  path: '/socket.io',
  transports: ['websocket'],
  // A function: called on every (re)connection, so each handshake gets a fresh single-use ticket.
  auth: (cb) => fetch('/bff/realtime/ticket').then((r) => r.json()).then(({ ticket }) => cb({ ticket })),
});
socket.on('connect_error', (err) => console.log(err.message, err.data?.code));
socket.emit('room:join', { room: `trip:${tripId}` }, (ack) => { if (!ack.ok) console.log(ack.error); });
socket.on('chat:message', (message) => { /* check message.tripId */ });
socket.on('notification:new', ({ id, type, title }) => { /* refresh the unread badge */ });
```

Flutter (`socket_io_client` package, same Socket.IO v4 protocol):

```dart
import 'package:socket_io_client/socket_io_client.dart' as IO;

final socket = IO.io(apiBaseUrl, IO.OptionBuilder()
    .setPath('/socket.io')
    .setTransports(['websocket'])
    .setAuth({'token': accessToken})        // the REST access token (no ticket needed)
    .disableAutoConnect()
    .build());
socket.onConnectError((error) {
  // error['data']['code'] == 'TOKEN_EXPIRED' → POST /api/auth/refresh, then:
  // socket.auth = {'token': newAccessToken}; socket.connect();
});
socket.onConnect((_) {
  socket.emitWithAck('room:join', {'room': 'trip:$tripId'}).then((ack) { /* ack['ok'] */ });
});
socket.on('chat:message', (message) { /* Map: id, tripId, sender, body, clientRequestId, createdAt */ });
socket.on('notification:new', (n) { /* { id, type, title } */ });
socket.connect();
```

Before reconnecting after a long pause, give the socket a fresh access token (`socket.auth = {...}`): an expired
one is refused with `TOKEN_EXPIRED`. Rooms are not restored by the server after a reconnection: join them again in
the `connect` handler. A disconnection with reason `"io server disconnect"` means the server closed the socket
(session ended, role changed, account deleted): reconnect once with a fresh credential; if it is refused with
`INVALID_TOKEN` (or the refresh fails), the session is over.

---

## 2. Carpooling — `/api/carpool`

Every route needs `Authorization: Bearer` (`401 AUTH_REQUIRED` / `TOKEN_EXPIRED` / `INVALID_TOKEN`). STUDENTs use
the module; ADMINs can read trips and cancel any of them; TEACHER and ALUMNI get `403 FORBIDDEN` (except `places`
and `settings`). Ids in the path are checked (`400 INVALID_ID`), unknown ones give `404 RESOURCE_NOT_FOUND`.

### JSON

```
Trip { id, driver: { id, firstname, lastname, rating, ratingCount }, direction: "TO_CAMPUS" | "FROM_CAMPUS",
       departure: { label, lat, lng }, destination: { label, lat, lng }, exactLocation,
       departureAt, seats, seatsLeft, pricePerSeat, distanceKm,
       preferences: { smoking, music, pets, womenOnly }, notes,
       status: "OPEN" | "FULL" | "CANCELLED" | "COMPLETED", cancelledAt, cancelledBy: "DRIVER" | "ADMIN" | null,
       cancelReason, myRole: "DRIVER" | "PASSENGER" | null, myRequest: { id, status, seats } | null,
       createdAt, updatedAt, distanceFromYouKm? }

Trip detail = Trip + {
       participants: null | [{ id, firstname, lastname, role: "DRIVER" | "PASSENGER", seats, rating, ratingCount,
                               me, myRating: { score, comment, createdAt } | null }],   // driver and accepted passengers only
       canRate,                                                                          // see "Ratings"
       requests: null | [TripRequest] }                                                  // the driver only

TripRequest { id, tripId, passenger: { id, firstname, lastname, rating, ratingCount }, seats, message,
              responseMessage, status: "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELLED" | "EXPIRED",
              createdAt, decidedAt, cancelledAt, cancelledBy: "PASSENGER" | "TRIP" | null }
TripMessage { id, tripId, sender: { id, firstname, lastname }, body, clientRequestId, createdAt }
TripRating  { id, tripId, raterId, rateeId, raterRole, rateeRole, score, comment, createdAt }
```

- `rating` = average of the carpool ratings the user received (1 decimal, `null` without any), `ratingCount` = how
  many. Names come from the account (snapshot names if the account was deleted). No e-mail anywhere.
- `myRole` / `myRequest` / `exactLocation` are computed for the signed-in user; `myRequest` is their latest request
  for the trip (the active one when there is one). `distanceFromYouKm` only in a search with a location.
- `notes`, `message`, `body`, `comment`, labels: plain text (line breaks kept where it makes sense), returned as
  sent — clients never render HTML.

### Coordinate privacy

`lat` / `lng` are **exact only for the driver and the accepted passengers** (`exactLocation: true`); everyone else
(other students, pending passengers, admins) gets them rounded to 2 decimals (~1 km). The search never touches the
exact points either: it runs on `searchPoint`, the off-campus end of the trip already rounded to 2 decimals, so
neither `distanceFromYouKm` nor varying the radius can reveal an exact address. `distanceKm` is the length of the
whole trip (0.1 km). Labels are what the driver typed (or the nearest known place when they sent none).

### Endpoints

| Endpoint | Who | Answer |
| -------- | --- | ------ |
| `GET /places` | any | `[{ id, label, lat, lng }]`: 18 curated Greater Tunis places for the picker |
| `GET /settings` | any | `{ campus: { label, lat, lng }, costPerKm, roadFactor, defaultRadiusKm, maxRadiusKm, minSeats, maxSeats, maxRequestSeats, maxPricePerSeat, maxDaysAhead, maxUpcomingTrips }` |
| `GET /trips?lat&lng&radiusKm&from&to&direction&seats&page&limit` | STUDENT, ADMIN | `{ items: [Trip], total, page, limit }` |
| `POST /trips` | STUDENT | `201` Trip detail |
| `GET /trips/:id` | STUDENT, ADMIN | Trip detail |
| `PATCH /trips/:id` | the driver | `200` Trip detail |
| `POST /trips/:id/cancel` `{ reason? }` | the driver, ADMIN | `200` Trip detail (`CANCELLED`) |
| `GET /me/trips?role=driver\|passenger&scope=upcoming\|past&page&limit` | STUDENT, ADMIN | `{ items: [Trip], total, page, limit }` |
| `GET /trips/:id/requests` | the driver | `[TripRequest]` (also in the trip detail) |
| `POST /trips/:id/requests` `{ seats?, message? }` | STUDENT, not the driver | `201` TripRequest + `trip` (Trip detail) |
| `POST /requests/:id/accept` | the driver | `200` TripRequest + `trip` |
| `POST /requests/:id/decline` `{ message? }` | the driver | `200` TripRequest + `trip` |
| `POST /requests/:id/cancel` | the passenger | `200` TripRequest + `trip` |
| `GET /trips/:id/messages?before&limit` | driver, accepted passengers | `{ items: [TripMessage] (oldest first), hasMore }` |
| `POST /trips/:id/messages` `{ body, clientRequestId? }` | driver, accepted passengers | `201` TripMessage, `200` on a replay |
| `POST /trips/:id/ratings` `{ userId, score, comment? }` | participants, after the trip | `201` TripRating |

### Offering a trip — `POST /trips`

Body: `{ direction?, departure?, destination?, departureAt, seats, pricePerSeat?, preferences?, notes? }`.

- `direction`: `TO_CAMPUS` (default) or `FROM_CAMPUS`. The campus side defaults to the campus (`CAMPUS_LABEL`,
  `CAMPUS_LAT`, `CAMPUS_LNG`, default ESPRIT Ghazela 36.8992, 10.1897): a `TO_CAMPUS` trip needs `departure`
  (destination optional), a `FROM_CAMPUS` trip needs `destination` (departure optional). The direction cannot be
  changed later (`400`, cancel and offer a new trip).
- A place is `{ label?, lat, lng }`: `lat` −90..90, `lng` −180..180 (numbers), `label` ≤ 120 characters on one line;
  without a label, the nearest curated place (or the campus) names it.
- `departureAt`: ISO 8601 with `Z` or an offset, or campus wall-clock `YYYY-MM-DDTHH:mm`.
- `seats` 1–6 (integer). `pricePerSeat` 0–20 DT, at most 3 decimals; when absent it is the suggested shared cost
  `distanceKm × CARPOOL_COST_PER_KM / (seats + 1)` rounded to 0.1 DT (`distanceKm` = haversine × 1.3, 0.1 km).
- `preferences`: booleans `smoking` (default false), `music` (true), `pets` (false), `womenOnly` (false; shown to
  passengers, not enforced: accounts have no gender). `notes` ≤ 500.
- Unknown fields (`status`, `seatsLeft`, `driver`, …) are ignored. Invalid fields → `400 VALIDATION_ERROR`,
  `details.<field>` (every invalid field at once). Then the rules, first broken one only, `400 VALIDATION_ERROR` with
  `details = { <field>: message, rule, … }`:

| `rule` | Field | Meaning |
| ------ | ----- | ------- |
| `IN_PAST` | `departureAt` | not in the future |
| `TOO_FAR_AHEAD` | `departureAt` | more than 30 days ahead (`details.maxDaysAhead`) |
| `SAME_PLACE` | `destination` | departure and destination less than 0.5 km apart |
| `TOO_LONG` | `destination` | more than 500 km apart |
| `SEATS_TAKEN` | `seats` | (update) fewer seats than already accepted (`details.taken`) |

- **Limit**: at most **5 upcoming OPEN/FULL trips** per driver → `409 TRIP_LIMIT_REACHED`, `details: { limit: 5,
  current }`. Simultaneous creations never exceed it: after the insert the driver's upcoming trips are listed by id
  and a trip beyond the fifth removes itself (exactly the extra ones fail).

### Updating — `PATCH /trips/:id` (driver only, `403` otherwise, admins included)

Any of `departure`, `destination`, `departureAt`, `seats`, `pricePerSeat`, `preferences` (merged), `notes`. Only
OPEN/FULL trips that have not left (`409 INVALID_STATE`, `details.status` or `details.reason: "DEPARTED"`).
Nothing known → `400 NO_CHANGES`; the same values → `200` without changes. Rules as above, plus:

- `seats` never below the seats already accepted (`SEATS_TAKEN`); `seatsLeft` moves by the same difference and the
  status follows (FULL at 0, OPEN otherwise), in one atomic update.
- The price cannot go up once a passenger is accepted (`409 INVALID_STATE`, `details.reason: "PRICE_LOCKED"`);
  lowering it is fine.
- A **time change** notifies the accepted and pending passengers, a **place change** the accepted passengers
  (`UPDATED`).

### Cancelling — `POST /trips/:id/cancel` `{ reason? (≤ 300) }`

The driver before the departure (`409 INVALID_STATE` `DEPARTED` after), or an **ADMIN** for any OPEN/FULL trip
(audited **`carpool.trip.cancel`**, `targetType: "Trip"`, metadata `{ driverId, departureAt, previousStatus,
passengersNotified, reason }`). Anyone else `403`. Already CANCELLED / COMPLETED → `409 INVALID_STATE`. Pending
requests become `CANCELLED` (`cancelledBy: "TRIP"`), accepted ones stay `ACCEPTED` (history). The accepted and
pending passengers are notified, and the driver too when an admin cancels.

### Search — `GET /trips`

- **With `lat` and `lng`** (both or none): OPEN trips whose **departure** (`TO_CAMPUS`) or **arrival**
  (`FROM_CAMPUS`) is within `radiusKm` (default `CARPOOL_SEARCH_RADIUS_KM` = 5, at most 20, decimals allowed) of
  the point — MongoDB `$geoNear` on a `2dsphere` index `{ searchPoint, status, departureAt }` — sorted by distance
  (0.1 km) then departure time, each with `distanceFromYouKm`.
- **Without a location**: upcoming OPEN trips sorted by departure time.
- `from` / `to`: `YYYY-MM-DD` (00:00 campus time), campus wall-clock or ISO; `to` exclusive. Default: from now to 31
  days ahead; a `from` in the past means now. `direction`: `TO_CAMPUS` | `FROM_CAMPUS`. `seats` (1–6, default 1):
  trips with at least that many seats left. Only OPEN trips (FULL, cancelled and completed trips are hidden).
- A STUDENT does not see their own trips (they are in `GET /me/trips`); ADMINs see every OPEN trip.
- Invalid values, repeated parameters → `400 VALIDATION_ERROR` (`details.<param>`).

### Requests and seat accounting

- `POST /trips/:id/requests` `{ seats: 1–3 (default 1), message? (≤ 300) }`. Checks, in this order: own trip →
  `403 FORBIDDEN` (`details.reason: "OWN_TRIP"`); trip CANCELLED/COMPLETED → `409 INVALID_STATE`; already left →
  `409 INVALID_STATE` (`DEPARTED`); an active (PENDING or ACCEPTED) request → `409 ALREADY_REQUESTED`
  (`details: { requestId, status }`); already 3 requests for this trip → `409 ALREADY_REQUESTED`
  (`details: { reason: "LIMIT", limit: 3 }`); FULL or fewer seats left → `409 TRIP_FULL` (`details.seatsLeft`).
  One active request per trip and passenger is also a unique partial index, so simultaneous requests create one.
- `accept` (driver): PENDING only (`409 INVALID_STATE`, `details.status`), before the departure. The seats are taken
  with one conditional update (`status: OPEN, seatsLeft >= n` → `seatsLeft - n`, FULL at 0), then the request switches
  PENDING → ACCEPTED; if that switch fails (cancelled or answered meanwhile) the seats are given back. **A trip is
  never overbooked**: not enough seats → `409 TRIP_FULL` (`details: { seatsLeft, requested }`). Other pending
  requests stay pending (the driver may accept them if seats free up).
- `decline` (driver) `{ message? }`: PENDING only; the message is returned as `responseMessage` and sent to the
  passenger.
- `cancel` (passenger): PENDING, or ACCEPTED before the departure — the seats come back atomically (FULL → OPEN) and
  the passenger's sockets leave the trip room. Exactly one of two simultaneous cancellations gives the seats back.
- Who: the driver answers (`403` for the passenger, `404` for anyone else); the passenger cancels (`403` for the
  driver — decline instead — `404` for anyone else).
- Invariant (checked under concurrency by the smoke tests): `seatsLeft = seats − Σ accepted seats`; it may be lower
  for a few milliseconds while an accept is rolled back, never higher.

### Chat

- Only the driver and the accepted passengers (`403 FORBIDDEN` otherwise, pending passengers and admins included).
- `GET /trips/:id/messages?before&limit`: the latest `limit` (1–100, default 50) messages before `before` (a message
  id of the trip or an ISO date-time), returned oldest first, `hasMore` when older ones exist.
- `POST /trips/:id/messages` `{ body (1–1000, trimmed, line breaks kept), clientRequestId? (UUID) }`: stored, then
  emitted as `chat:message` to the room `trip:<id>`. The same sender + `clientRequestId` returns the first message
  (`200`, no second emit), also for simultaneous replays (unique partial index); the same id on another trip →
  `409 ALREADY_EXISTS` (`details.field: "clientRequestId"`). Not on a cancelled trip (`409 INVALID_STATE`,
  `details.reason: "TRIP_CANCELLED"`) nor more than 7 days after the departure (`"CHAT_CLOSED"`); reading stays
  possible.
- **Rate limit**: `RATE_LIMIT_CARPOOL_MESSAGE_MAX` (30) messages per `RATE_LIMIT_CARPOOL_MESSAGE_WINDOW_MS` (1 min) and
  user → `429 TOO_MANY_REQUESTS` (`Retry-After`, `details.retryAfter`).
- No notification per message (real time only).

### Ratings — `POST /trips/:id/ratings`

`{ userId, score: 1–5 (integer), comment? (≤ 300) }` (`ratee` and `rating` are accepted as aliases). Each participant
(driver and accepted passengers) rates each other participant once: rater not a participant → `403`; trip cancelled
→ `409 INVALID_STATE` (`TRIP_CANCELLED`); before departure + 1 h → `409 INVALID_STATE` (`details.reason: "TOO_EARLY",
opensAt`); oneself or a non-participant → `400 VALIDATION_ERROR` (`details.userId`); twice → `409 ALREADY_RATED`
(unique index). Ratings cannot be edited. The trip detail tells participants `canRate` and `myRating` for each
other participant.

### History and completion — `GET /me/trips`

- A trip is **past one hour after its departure**. `scope=upcoming` (default): departure + 1 h still ahead, soonest
  first; `scope=past`: latest first. Every status is listed (cancelled trips included).
- `role=driver` (default): own trips. `role=passenger`: upcoming = trips with a PENDING or ACCEPTED request, past =
  trips where the request was ACCEPTED.
- Job **`carpool.complete-trips`** (every `SCHEDULER_INTERVAL_MS`): OPEN/FULL trips one hour after their departure
  become `COMPLETED` (each claimed with `findOneAndUpdate`, safe with several instances, 100 per run), their pending
  requests `EXPIRED`, and the participants of trips with passengers get a `RATE` notification.

### Notifications (`type: "CARPOOL"`, recipient's locale, in-app + push)

Link `/dashboard/carpool/<tripId>`, `data = { kind, tripId, requestId? }`, push tag `carpool-<kind>-<id>`.

| `kind` | Who | Title (fr / en) |
| ------ | --- | --------------- |
| `REQUEST` | driver | « Nouvelle demande pour ton trajet Ariana → ESPRIT Ghazela (ven. 9 oct. à 07:45) » / "New seat request for your trip …" (body: who, seats, message) |
| `ACCEPTED` | passenger | « Demande acceptée : … » / "Request accepted: …" |
| `DECLINED` | passenger | « Demande refusée : … » / "Request declined: …" (+ the driver's message) |
| `REQUEST_CANCELLED` | driver | « Demande annulée : … » / "Request cancelled: …" |
| `TRIP_CANCELLED` | accepted and pending passengers (+ driver when an admin cancels) | « Trajet annulé : … » / "Trip cancelled: …" (+ reason) |
| `UPDATED` | time change: accepted and pending passengers; place change: accepted passengers | « Horaire modifié : … » / "Time changed: …", « Trajet modifié : … » / "Trip updated: …" |
| `RATE` | participants of a completed trip with passengers | « Comment s’est passé ton trajet ? … » / "How was your trip? …" |

Nobody is notified about their own action. Every notification is also pushed to open clients as `notification:new`.

### Rate limits (per user, in memory, skipped with `RATE_LIMIT_ENABLED=false`)

| Route | Limit |
| ----- | ----- |
| `POST /trips/:id/messages` | `RATE_LIMIT_CARPOOL_MESSAGE_MAX` (30) per `RATE_LIMIT_CARPOOL_MESSAGE_WINDOW_MS` (60000) |
| `POST /trips` | `RATE_LIMIT_CARPOOL_TRIP_MAX` (20) per `RATE_LIMIT_CARPOOL_WINDOW_MS` (3600000) |
| `POST /trips/:id/requests` | `RATE_LIMIT_CARPOOL_REQUEST_MAX` (30) per `RATE_LIMIT_CARPOOL_WINDOW_MS` |
| `GET /api/realtime/ticket` | `RATE_LIMIT_REALTIME_TICKET_MAX` (60) per minute |

### Error codes of the module

`VALIDATION_ERROR` (400, `details`, `details.rule` for the trip rules), `NO_CHANGES` (400), `INVALID_ID` (400),
`INVALID_JSON` (400), `AUTH_REQUIRED` / `TOKEN_EXPIRED` / `INVALID_TOKEN` (401), `FORBIDDEN` (403),
`RESOURCE_NOT_FOUND` (404), `TRIP_FULL` (409), `ALREADY_REQUESTED` (409), `TRIP_LIMIT_REACHED` (409),
`ALREADY_RATED` (409), `ALREADY_EXISTS` (409, `clientRequestId`), `INVALID_STATE` (409, `details.status` or
`details.reason`: `DEPARTED`, `PRICE_LOCKED`, `TRIP_CANCELLED`, `CHAT_CLOSED`, `TOO_EARLY`), `TOO_MANY_REQUESTS` (429).

### Configuration

`CAMPUS_LAT` (36.8992), `CAMPUS_LNG` (10.1897), `CAMPUS_LABEL` (ESPRIT Ghazela), `CARPOOL_SEARCH_RADIUS_KM` (5),
`CARPOOL_COST_PER_KM` (0.25), `SCHEDULER_INTERVAL_MS` (completion job), `CORS_ORIGINS` (also for Socket.IO),
`PUBLIC_API_URL` (ticket `url`), the rate limit variables above.

### Demo data — `scripts/seed/60-carpool.js`

Idempotent: deletes the trips with `source: "SEED"` and everything attached to them (requests, messages, ratings),
then creates 16 trips (times relative to the day of the seed): 11 upcoming from Ariana, La Marsa, Ennasr, Lac 2,
Le Bardo, Ben Arous, Raoued, La Soukra, La Manouba and two from the campus (Yasmine to El Menzah, Aya to the city
centre), with pending and accepted requests (Nour's Lac 2 trip is FULL) and chat messages; 4 completed trips with
ratings (Yasmine was a passenger of Ahmed and Nour and still has ratings to give; Omar rated her as a driver) and a
cancelled one. No notification is sent. Demo accounts: `yasmine.haddad@campuslink.local` (passenger of Ahmed's trip,
driver of the El Menzah trip), `ahmed.karray@`, `omar.ferchichi@` (en), … password `Campus123!`.

### Known limitations

- Single instance for the real-time layer (see above); the per-user rate limits are per instance too.
- `womenOnly` is informative only. Places have no reverse geocoding: a position without a label is named after the
  nearest curated place.
- A deleted account keeps its trips and requests (names from the snapshots); its sockets are closed at once (they
  leave every `trip:` room).
- Sockets opened with a credential issued before sessions had ids (no `sid`) are only closed when every session of
  the account ends, the role changes or the account is deleted, not by a single logout.
