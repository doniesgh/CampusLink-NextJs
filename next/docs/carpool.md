# Carpooling and the real-time layer — web (Module 2)

Phase 3 contract, sections 1, 2 and 5 ([`docs/phase3-contract.md`](../../docs/phase3-contract.md)). API reference:
[`backend/docs/carpool.md`](../../backend/docs/carpool.md). Everything in [`next/README.md`](../README.md) still
applies (BFF, offline data layer, Server Actions for mutations that can fail with a 4xx, CSP, message namespaces).

## Files

| Path | Role |
| ---- | ---- |
| `lib/realtime/client.ts` | The Socket.IO client singleton (one connection per tab): tickets, reconnection, rooms, offline |
| `lib/realtime/hooks.ts`, `lib/realtime/index.ts` | `useRealtimeEvent`, `useRealtimeRoom`, `useRealtimeStatus` |
| `app/(back)/dashboard/carpool/layout.tsx` | Adds the `carpool` messages to the Client Components of both pages |
| `app/(back)/dashboard/carpool/page.tsx` | `/dashboard/carpool` (STUDENT; other roles are sent to `/dashboard`): server snapshot of the places, the settings, the tab in the address and the driver's upcoming trips |
| `app/(back)/dashboard/carpool/[id]/page.tsx` | `/dashboard/carpool/[id]` (STUDENT): the trip (+ the latest 50 messages for participants), "not available" state |
| `app/(back)/dashboard/carpool/actions.ts` | Server Actions: create a trip, request a seat, cancel a request, accept / decline, cancel a trip, send a message, rate |
| `components/carpool/carpool-view.tsx` | Tabs "Find a trip" / "Offer a trip" / "My trips", URL state |
| `components/carpool/search-panel.tsx` | Search form (`role="search"`) and results |
| `components/carpool/place-picker.tsx`, `use-geolocation.ts` | Place select + "Use my location" (Geolocation API, permission handling) |
| `components/carpool/offer-form.tsx` | "Offer a trip" with the suggested shared cost |
| `components/carpool/my-trips.tsx` | "My trips" (driver / passenger, upcoming / past), refreshed live |
| `components/carpool/trip-card.tsx` | Trip card (`article[data-trip-id]`), `RouteText`, `Initials` |
| `components/carpool/trip-view.tsx` | Trip page: header, cancel dialog, sections, live refresh |
| `components/carpool/trip-details.tsx`, `seat-panel.tsx`, `requests-manager.tsx`, `rating-panel.tsx`, `trip-chat.tsx` | Trip sections |
| `components/carpool/trip-not-found.tsx` | "This trip isn't available." state (its title is the page's h1), used by the server page and the client view |
| `components/carpool/badges.tsx`, `use-carpool-format.ts`, `trip-actions.ts` | Status / direction badges, rating, preferences; prices, distances, dates; action types |
| `lib/carpool/types.ts` | API shapes, limits, guards (`isTrip`, `isTripDetail`, `isParticipant`…) |
| `lib/carpool/paths.ts` | Web pages, API paths, offline query keys, URL state (`parseCarpoolParams`, `carpoolQuery`, `searchQuery`, `myTripsQuery`) |
| `lib/carpool/geo.ts` | Haversine, road distance (× 1.3), suggested price (same formula and rounding as the API), OpenStreetMap link |
| `lib/carpool/validation.ts` | Form checks shared by the browser and the Server Actions (keys of `carpool.validation`) |
| `lib/carpool/server.ts` | Server only: localised failures of the carpool API (`carpoolFailure`, rules, codes) |
| `messages/{en,fr}/carpool.json` | Namespace `carpool` (same keys in both files; French uses "tu") |

## Real-time layer (`lib/realtime`)

Client Components only. **One Socket.IO connection per tab**, opened by the first component that uses a hook and
closed 5 s after the last one unmounts (a client-side navigation between two carpool pages keeps it).

```tsx
"use client";
import { useRealtimeEvent, useRealtimeRoom, useRealtimeStatus } from "@/lib/realtime";

// Any event sent to the user's room (user:<id>) or to a joined room. The latest handler is always used.
useRealtimeEvent<{ id: string; type: string; title: string }>("notification:new", (n) => refreshBadge());

// Stay in a room while mounted (null = none). joins grows on every successful join (reconnections included):
// fetch again what may have been missed while disconnected when it changes.
const { status, error, joins } = useRealtimeRoom(`trip:${tripId}`); // "joining" | "joined" | "error" (FORBIDDEN…)

const connection = useRealtimeStatus(); // idle | connecting | connected | reconnecting | offline | unavailable
```

- **URL**: `NEXT_PUBLIC_REALTIME_URL` (default `http://localhost:4000`), inlined **at build time**, like the
  CSP `connect-src` entry of `lib/csp.ts` (its http(s) and ws(s) origins): build with the public URL of the API.
  Path `/socket.io`, `transports: ["websocket"]` (no long-polling).
- **Authentication**: the browser has no access token (httpOnly cookies). `auth` is a callback, so every handshake
  (first connection and every reconnection) fetches a fresh **single-use** ticket from `GET /bff/realtime/ticket`
  (the BFF adds the token and refreshes it when needed). A ticket is never reused.
- **Refused handshake** (`connect_error` with `data.code` `AUTH_REQUIRED` / `INVALID_TOKEN` / `TOKEN_EXPIRED` /
  `TOO_MANY_CONNECTIONS`): Socket.IO does not retry those by itself, so the client tries again with a new ticket
  after 1 s, 3 s, 10 s, then every 30 s. A `401` from the ticket endpoint means the session is over: the layer stops
  (`unavailable`); the next BFF call of the page sends the user to `/auth/expired`.
- **Transport failures** (server restarted, network blip): Socket.IO reconnects by itself (1 s to 30 s) with a new
  ticket; `useRealtimeRoom` joins its rooms again after every reconnection (the server does not restore them).
- **Silent offline**: when the browser goes offline the socket is closed on purpose (no reconnection attempts, so
  no failed WebSocket or ticket request in the console) and the status is `offline`; it reconnects when the
  connection comes back (`online` event, or the BFF reachable again — `lib/offline/status.ts`).
- Events are dispatched to every subscriber; a failing handler is reported (`reportError`) without breaking the
  others. Another account in the same tab (data owner change) gets a new socket.
- Join failures: `FORBIDDEN`, `UNKNOWN_ROOM`, `INVALID_ROOM`, `TOO_MANY_ROOMS` stay until the next connection or
  `retry()`; `TOO_MANY_REQUESTS`, `INTERNAL_ERROR` and a 10 s ack timeout are retried after 3 s.
- Server events used by the carpool pages: `chat:message` (room `trip:<id>`), `trip:updated` (room), and
  `carpool:request` (user room). Every module's notifications also arrive as `notification:new` (the shell does not
  listen to it yet: see "Known limits").

## `/dashboard/carpool` (STUDENT)

h1 "Carpooling". Tabs (`role="tablist"` "Carpooling"): **Find a trip**, **Offer a trip**, **My trips** (only the
active tab is mounted). URL state (History API, no server round trip; the server renders the data of the
address it receives): `?tab=search|offer|mine&place=<placeId>&radius=2|5|10|15|20&date=YYYY-MM-DD&direction=TO_CAMPUS|FROM_CAMPUS&seats=1|2|3&page=<n>&role=driver|passenger&scope=upcoming|past`.

### Find a trip

- `form[role=search]` "Find a trip":
  - **"Your area"**: native select of the 18 curated places (`GET /bff/carpool/places`, rendered on the server),
    first option "Anywhere", plus the button **"Use my location"**. Clicking it calls
    `navigator.geolocation.getCurrentPosition` (nothing is asked before the click). Outcomes are announced under
    the field (`[data-testid=geo-status][data-geo=locating|located|denied|unavailable|timeout|unsupported]`,
    `aria-live="polite"`): "Finding your location… Your browser may ask for permission.", "Using your location
    (accurate to about 30 m). It's only used here and never saved.", or a clear message with what to do instead
    (blocked for the site → allow it in the site settings or pick a place; unavailable; too long; not supported /
    insecure origin). A permission already blocked (Permissions API) is reported without calling the API. Once
    located, the option "My location" is added and selected. The position is rounded to 3 decimals (~100 m) and
    never put in the address; it only lives in memory and in the key of the saved results (IndexedDB, scoped to
    the account and cleared at logout).
  - "Radius" (2–20 km, default `defaultRadiusKm` of `/settings`; disabled without an area), "Seats needed" (1–3),
    "Date" (empty = the next 30 days; `from=date&to=date+1`), "Direction" ("Both directions" / "To campus" / "From
    campus"). Every change applies at once (page 1); "Search" fetches again; "Reset filters". On phones: radius and
    seats side by side, date and direction full width.
- h2 "Trips" + "3 trips within 5 km" (`[data-testid=carpool-count]`), cards in a list, "Previous" / "Next"
  (`nav` "Pages") by 20. Without an area: upcoming trips by departure time; with one: by distance, then time.
- Card `article[data-trip-id][data-status][data-direction]` (`trip-card.tsx`), the whole card links to the trip:
  "Tomorrow · 07:45", the route as the link ("Ariana → ESPRIT Ghazela", read "Ariana to ESPRIT Ghazela"), the price
  (`[data-testid=trip-price]`: "2.5 DT" + "per seat", or "Free"), "1.2 km from you" / "1.2 km from Ariana"
  (`[data-testid=trip-distance-from]`), "2 seats left" (`[data-testid=trip-seats]`), "12.4 km trip", the driver with
  the rating ("★ 4.7 (12)", read "Rated 4.7 out of 5 (12 ratings)"; "No ratings yet"), direction badge
  (`[data-direction]`), status badge when not open, the viewer's request status (`[data-request-status]`).
- Empty: "No trips match your search." Offline: the results already loaded on this device ("Saved copy from …").

### Offer a trip

Form "Offer a trip" (`offer-form.tsx`): radios "Direction" ("To campus" / "From campus"); "Departure" (or
"Destination" from campus) = the place picker with "Use my location" (the driver's position, 5 decimals: exact
places are only shown to accepted passengers), hint "Arrival: ESPRIT Ghazela."; "Meeting point (optional)" (label
≤ 120 characters, replaces the place's name); "Date" (today … +30 days) and "Departure time" (campus time, 5-minute
steps; default tomorrow 08:00); "Seats offered" (1–6, default 3); **"Price per seat (DT)"** prefilled with the
suggested shared cost and the hint "Suggested shared cost: 0.8 DT per seat for about 12.4 km." (distance =
haversine × 1.3, price = distance × 0.25 / (seats + 1), from `/settings`; it follows the place and the seats until
edited; "Use the suggested price" puts it back); checkboxes "Music on board", "Smoking allowed", "Pets welcome",
"Women only"; "Notes for passengers (optional)" (≤ 500); button **"Publish trip"**.

- Checked in the browser (first invalid field focused, messages under the fields), again by the Server Action and
  by the API (`details.rule` → `carpool.rules.*`: in the past, more than 30 days ahead, same place, too long).
- "You have 2 of 5 upcoming trips." (`[data-testid=offer-limit]`); at 5: an info message and the button is
  disabled (`TRIP_LIMIT_REACHED` is also translated).
- Success opens the new trip with "Your trip is published. Passengers can now send you requests."
  (`?done=created`, then removed from the address).

### My trips

Groups "Show my trips" ("As driver" / "As passenger") and "Period" ("Upcoming" / "Past"), `aria-pressed`; trip
cards (every status, cancelled ones included; a trip is past one hour after its departure), pages of 20, empty
states with "Offer a trip" / "Find a trip". Refreshed live when a request is sent, answered or cancelled
(`carpool:request`). Offline: the lists loaded on this device.

## `/dashboard/carpool/[id]` (STUDENT)

Layout: on phones the action section (request / requests / rating) comes first, then the chat, then the trip
details; from `lg` the actions and the details are on the left and the chat (sticky) on the right.

- "Back to carpooling", direction and status badges, h1 = the route (`[data-testid=trip-title]`), "Tomorrow · 07:45 ·
  2.5 DT per seat". Cancelled: "This trip was cancelled by the driver." / "… by the CampusLink team." + "Reason: …"
  (`[data-testid=trip-cancelled]`). Departed: "This trip has left." / "This trip is over.".
- **Trip details** (`trip-details.tsx`, `dl`): Departure, Arrival (campus badge), When, Seats ("2 of 4 left",
  `[data-testid=trip-seats-left][data-seats-left]`), Price, Distance; "Places are approximate (about 1 km)…" for
  everyone but the driver and the accepted passengers, who get "Open the map" links (OpenStreetMap, new tab);
  driver + rating, preferences chips (`[data-preference]`), notes (plain text), "On board" (participants only:
  `li[data-participant-id][data-role]`).
- **Passenger** (`seat-panel.tsx`, section "Request a seat" / "Your seat"): "Seats" (1 … min(3, seats left)),
  "Message to the driver (optional)" (≤ 300), **"Send request"** → "Request sent. You'll get a notification when
  the driver answers.". Then `[data-testid=seat-state][data-state=PENDING|ACCEPTED|FULL]`: "Your request for 1 seat
  is waiting for Ahmed Karray's answer." + "Cancel my request" (confirmation "Cancel request"), or "You have 1 seat on
  this trip. See you there!" + "Give up my seat" (confirmation "Give up seat"). "This trip is full.", "Your last
  request was declined…".
- **Driver** (`requests-manager.tsx`, section "Seat requests", "<n> pending requests"
  `[data-testid=pending-requests]`): `li[data-request-id][data-status]` with the passenger and rating, seats, "sent
  …", the message (plain text), the status badge; pending ones have **"Accept"** (name "Accept Lina Bouazizi's
  request"; disabled with "Not enough seats left for this request." when it does not fit) and **"Decline"** (dialog
  "Decline Lina Bouazizi's request?", "Message to Lina Bouazizi (optional)", "Decline request"). Outcomes: "Lina
  Bouazizi is on board." / "Request from … declined.". Header button **"Cancel trip"** (OPEN/FULL, before the
  departure): dialog "Cancel this trip?", "Reason (optional)", "Keep the trip" / "Confirm cancellation".
- **Trip chat** (`trip-chat.tsx`, driver and accepted passengers; others see "The chat opens as soon as the driver
  accepts your request." or "The chat is for the driver and the accepted passengers."):
  - live indicator `[data-testid=chat-connection][data-state=connecting|connected|reconnecting|offline|error|unavailable]`
    ("Live", "Reconnecting…", "Offline: new messages show up when you're back."…);
  - `[role=log]` (`[data-testid=chat-log]`, polite live region around an `ol`, so the list keeps its semantics):
    `li[data-message-id][data-mine][data-state=sent]`
    with the sender (others) or "You" (screen readers), the body (`[data-testid=chat-body]`, plain text, line breaks
    kept) and the time; a day heading ("Today", "Tomorrow", "Mon, Oct 5") above the first message of each day;
    "Load earlier messages" (pages of 50 with `before=<oldest id>`, the scroll position is kept);
  - composer: textarea "Message" (`#chat-message`, ≤ 1000, Enter sends, Shift + Enter = new line, "<n>
    characters left") and "Send";
  - **optimistic sending**: the message shows at once (`li[data-client-request-id][data-state=sending]`, "Sending…"),
    then is replaced by the stored one (from the action's answer or the `chat:message` event, whichever comes first,
    matched by `clientRequestId`). Offline (or server unreachable): `data-state=waiting` "Waiting for the
    connection…", sent automatically on reconnection, in order, with the same `clientRequestId` (the API answers a
    replay with the first message: never a duplicate). Refused (chat closed, rate limit): `data-state=failed`, the
    reason, "Retry" / "Remove";
  - **reconnection**: after every (re)join of `trip:<id>` the latest page is fetched again and merged by id, so
    messages sent while disconnected appear;
  - closed: "This trip was cancelled: the chat is read-only." / "This chat is closed (7 days after the trip)…".
- **Rate your trip** (`rating-panel.tsx`, when the API says `canRate`: participant, departure + 1 h, not cancelled):
  each other participant (`li[data-participant-id][data-rated]`) with radios "1 star" … "5 stars" (fieldset "Your
  rating for Ahmed Karray"), "Comment (optional)" (≤ 300), "Send rating" → "Thanks! Your rating for … was sent."; once
  rated: "You gave Ahmed Karray 5/5." + the comment. "You've rated everyone on this trip. Thanks!".
- Live updates: `trip:updated` (room) and `carpool:request` (user room) for this trip refresh it (seats, status,
  requests, participants): the driver sees new requests appear, a passenger sees the acceptance and the chat opens.
- Unknown / invalid id: h1 "This trip isn't available." (`[data-testid=trip-not-found]`) + "Back to carpooling"; a trip
  that can't be loaded (server unreachable, nothing saved on this device): h1 "The trip couldn't be loaded." + "Try again".

## Data, mutations and offline mode

- Both pages render their first data on the server (`serverSnapshot` / `serverApi`) and hand it to
  `useOfflineQuery` (keys `carpool:search:<point>:<radius>:<date>:<direction>:<seats>:<page>`,
  `carpool:mine:<role>:<scope>:<page>:<limit>`, `carpool:trip:<id>`), so loading a page makes no API request from the
  browser (only the real-time ticket on trip pages and in "My trips").
- Mutations are **Server Actions** (`app/(back)/dashboard/carpool/actions.ts`, `serverApi()`), so expected 4xx
  answers never reach the browser's `fetch`; the trip page replaces its query with the trip the API returns (no
  server re-render). Codes are translated (`carpool.errors.*`, `carpool.rules.*`): `TRIP_FULL`, `ALREADY_REQUESTED`
  (and `LIMIT`), `TRIP_LIMIT_REACHED`, `ALREADY_RATED`, `INVALID_STATE` reasons (`DEPARTED`, `PRICE_LOCKED`,
  `TRIP_CANCELLED`, `CHAT_CLOSED`, `TOO_EARLY`), `OWN_TRIP`, `RESOURCE_NOT_FOUND`, `TOO_MANY_REQUESTS`; when the trip
  changed meanwhile the page fetches it again.
- Outcomes are shown in the section that was used (one `role="status"` / `role="alert"` at a time in `<main>`):
  header (created, cancelled), seat section, requests section, rating section. The chat reports per message.
- The carpool pages are not saved by the service worker (phase 3 contract: no offline requirement). Data already
  loaded stays readable through IndexedDB after a client-side navigation; actions are disabled offline ("You're
  offline: actions come back with the connection."), except the chat composer, whose messages wait (see above).
- Never HTML: labels, notes, messages and comments are rendered as text.

## Notes for E2E tests

- The search form, the offer form, "My trips" and the trip page carry `data-ready="true"` once hydrated
  (`form[role=search][data-ready]`, `[data-testid=trip-view][data-ready]`…). Wait for it before using a control:
  a select changed before hydration is reset by React (the change is lost).
- Labels to use: `getByLabel('Your area')`, `getByRole('button', { name: 'Use my location' })`, `getByLabel('Radius')`,
  `getByLabel('Departure', { exact: true })`, `getByLabel('Price per seat (DT)')`, `getByLabel('Message', { exact:
  true })` (chat), `getByRole('radio', { name: '4 stars' })`. Geolocation: `context.grantPermissions(['geolocation'])`
  + `context.setGeolocation(...)`; without the permission the status says the access is blocked (`data-geo=denied`).
- Other roles visiting a carpool page are redirected to `/dashboard` by the client after streaming: wait for the URL.
- Real-time: the trip page shows `[data-testid=chat-connection][data-state=connected]` once the socket is connected
  and the room joined. `context.setOffline(true)` closes it (`offline`) and `setOffline(false)` reconnects it.

## Checks

- `npx tsc --noEmit --incremental false`, `npm run lint`, `NEXT_DIST_DIR=.next-carpool npx next build`.
- End to end (production build with `NEXT_PUBLIC_REALTIME_URL` = the API, real backend and MongoDB, demo seed):
  STUDENT pages in English and French, desktop (1366×900) and mobile (390×844), light and dark, no horizontal
  scroll, console errors or CSP violations: search by place / by geolocation (granted, denied), filters and paging,
  offer a trip (validation, suggested price, publish), my trips, a seat request accepted live by the driver, the
  chat between the driver and the passenger in two browser contexts (optimistic message, live delivery, offline
  messages sent on reconnection without duplicates), decline, cancel a request, cancel a trip, ratings; TEACHER,
  ALUMNI and ADMIN are sent to `/dashboard`.
- API restarted while a chat is open: the indicator says "Reconnecting…", then the client reconnects by itself
  with a new ticket, joins `trip:<id>` again and receives the next message live (the browser only logs the refused
  WebSocket attempts while the API is down).
- axe-core on every state (search, offer with errors, my trips, trip as passenger / driver / outsider, past trip
  with ratings, decline dialog, not found) in English light desktop and French dark mobile: no violation.

## Known limits

- The app shell does not listen to `notification:new` yet (it is not a carpool file): the unread badge still
  refreshes on navigation. `useRealtimeEvent("notification:new", …)` in `components/shell` would make it live.
- Admins can cancel any trip through the API, but the web pages are for students only (contract section 5).
- Editing a trip (`PATCH /trips/:id`) has no web form yet: drivers cancel and offer a new trip.
- The real-time layer follows the backend's single-instance limit (rooms and used tickets in memory).
