# Bookings (Module 5) — web

Room and equipment booking, phase 2 contract section 1 and 4 ([`docs/phase2-contract.md`](../../docs/phase2-contract.md)).
The API is described in [`backend/docs/bookings.md`](../../backend/docs/bookings.md). Everything in `next/README.md`
still applies (BFF, offline data layer, Server Actions for mutations that can fail with a 4xx, UI primitives, campus
timezone, FR "tu" / EN messages).

## Files

| File | Role |
| ---- | ---- |
| `app/(back)/dashboard/bookings/page.tsx` | `/dashboard/bookings` (STUDENT, TEACHER, ADMIN; ALUMNI → `/dashboard`): renders the resources, the first page of upcoming bookings and the week of the resource in the URL on the server |
| `app/(back)/dashboard/bookings/layout.tsx` | adds the `bookings` messages for the Client Components |
| `app/(back)/dashboard/bookings/actions.ts` | Server Actions `createBookingAction`, `cancelBookingAction` |
| `app/(back)/dashboard/admin/bookings/page.tsx` | `/dashboard/admin/bookings` (ADMIN): sections nav + one section per render |
| `app/(back)/dashboard/admin/bookings/layout.tsx` | adds the `bookings` messages |
| `app/(back)/dashboard/admin/bookings/actions.ts` | `approveBookingAction`, `rejectBookingAction`, `adminCancelBookingAction`, `saveEquipmentAction`, `deleteEquipmentAction` |
| `components/bookings/bookings-view.tsx` | tabs "Book" / "Free rooms" / "My bookings", URL state, the Book tab |
| `components/bookings/resource-picker.tsx` | Rooms / Equipment toggle, filters, radio cards |
| `components/bookings/availability-panel.tsx` | Day (timeline) / Week (agenda) views, free times as buttons |
| `components/bookings/booking-form.tsx` | booking form, live rule checks, overlap warning, conflicts |
| `components/bookings/free-rooms.tsx` | free-room finder |
| `components/bookings/my-bookings.tsx` | My bookings (upcoming / past, cancel, offline) |
| `components/bookings/booking-card.tsx`, `status-badge.tsx`, `resource-icon.tsx`, `use-booking-format.ts` | shared pieces |
| `components/bookings/admin/*` | pending approvals, decision dialogs, all bookings, equipment manager, usage statistics (recharts) |
| `lib/bookings/types.ts` | API shapes (`Booking`, `Equipment`, `BookableRoom`, `Availability`, `BookingStats`…) |
| `lib/bookings/rules.ts` | booking rules (same as the API), 15-minute time options, free intervals, URL state, query keys |
| `lib/bookings/server.ts` | server-only: localized failures of the bookings API (`bookingFailure`), `bookingWhen` |
| `messages/{en,fr}/bookings.json` | texts (same keys in both files) |

The admin academic room form (`app/(back)/dashboard/admin/academic/*`) also has the two room fields: checkboxes
"Bookable" and "Requires approval" (follows the type, checked for an amphitheater, until changed by hand), sent as
JSON booleans; the rooms table shows "Not bookable" / "Approval" badges. Their labels come from `bookings.roomForm`
(passed by the page, since that page's client only has the `admin` messages).

## `/dashboard/bookings`

h1 "Bookings". Tabs (Radix, `role="tablist"` labelled "Bookings"): **Book**, **Free rooms**, **My bookings** (only
the active tab is mounted; on phones the three tabs share the width, without icons).

URL state (History API, no server round trip): `?tab=book|free|mine&type=ROOM|EQUIPMENT&resource=<id>&view=day|week&date=YYYY-MM-DD&scope=upcoming|past`
and `booking=<id>` (notification links `/dashboard/bookings?booking=<id>`). Without `tab`: "My bookings" for a
notification link or while offline, "Book" otherwise. Without `view`: day on phones, week otherwise.

### Book

1. **Choose a resource** — group "Resource type" with "Rooms" / "Equipment" (`aria-pressed`); filters "Search",
   "Room type", "Minimum capacity", "Building" (rooms) or "Category" (equipment); "<n> results"; the resources are
   radio cards (`li[data-resource-id]`, radio named after the resource, arrow keys move between them) with type,
   building / location, seats and a "Needs approval" badge. Only bookable rooms and active equipment are offered.
2. **Availability of <name>** — group "View" ("Day" / "Week"), group "Change period" ("Previous" / "Today" /
   "Next"), the period as an `h3` (`aria-live`), a legend, then:
   - Day (`[data-testid=availability-day]`): proportional 07:00–21:00 timeline; busy entries
     `li[data-kind=BOOKING|CLASS][data-status][data-mine]` ("Booked", "Class", "Your booking: <purpose>", "· pending";
     admins see the API's details), free times `li[data-kind=FREE]` with a button "Free 07:00–16:30: use this time";
     the past part of today is shaded and the form's selection is outlined.
   - Week (`[data-testid=availability-week]`): one `section[data-day]` per day (Monday → Sunday) listing busy and
     free times, "Day view" opens that day; past days say "This day is over.".
   - The week is one offline query (`bookings:availability:<type>:<id>:<monday>`); a saved copy shows "Saved copy
     from <time>." offline.
3. **Book it** / **Ask for it** (approval resources) — "Date" (min today, max today + 60 days), "Start time" and
   "End time" (native selects on the 15-minute grid, 07:00–21:00; the end keeps the duration when the start
   changes), "Duration: …", "Purpose" (2–300 characters). Picking a free time fills the form (one hour from the
   quarter hour that was clicked in the day timeline, or from the start of the free time with the keyboard) and
   focuses "Purpose". On phones, tapping a resource scrolls to its availability (arrow keys do not).
   - The rules are checked in the browser after a first submit, again in the Server Action and by the API; rule
     violations come back translated from `details.rule` (`bookings.rules.<RULE>`).
   - "This time overlaps:" warns before sending when the loaded week has a busy time in the way.
   - Students see "You have <n> of 3 upcoming bookings." (from the first page of upcoming bookings).
   - Submit "Book" / "Send request" (disabled offline). Success: `role="status"` "Booked: A12, Fri, Oct 9,
     16:30–17:30." or "Request sent for …" + "See my bookings"; the new booking is added to the calendar and every
     bookings query is revalidated. Failures: `role="alert"` — "This time is already taken:" with the conflicts
     ("Class, …", "Booked, …", "Your booking, …"), the student limit, field errors.

### Free rooms

`form[role=search]` "Find a free room": "Date", "Start time", "End time", "Minimum capacity", "Room type", button
"Find free rooms" (searches once on open with the next free hour). Results `li[data-room-id]` with "Book this room"
(accessible name "Book <room>"), which opens the Book tab on that room with the same day and times.

### My bookings

h2 "My bookings", group "Show" ("Upcoming" / "Past"), pages of 20 ("Previous" / "Next"). Each booking is an
`article[data-booking-id][data-status]` (`booking-card.tsx`): resource, status badge ("Pending", "Confirmed",
"Rejected", "Cancelled"), day and times, purpose, the admin's note ("Reason: …" for a rejection), "Cancelled by an
admin.". Upcoming PENDING / CONFIRMED bookings that have not started have "Cancel booking" → "Cancel this booking?" →
"Confirm cancellation" (`cancelBookingAction` with the displayed `version`; VERSION_CONFLICT / INVALID_STATE reload
the list). The booking of a notification link is highlighted (or shown first under "From your notification").

**Offline**: the page is saved by the service worker and each list (`bookings:me:<scope>:<page>`) stays readable
from IndexedDB ("Saved copy from <time>."); cancelling and booking are disabled with a short explanation.

## `/dashboard/admin/bookings` (ADMIN)

h1 "Bookings & resources", `nav` "Sections" with links "Pending approvals (<n>)", "All bookings", "Equipment",
"Statistics" (`?tab=pending|all|equipment|stats`, server-rendered, never saved offline).

- **Pending approvals**: every PENDING request (`article[data-booking-id]`) with requester, "Sent <time>", "Reject"
  and "Approve" (dialogs: optional "Note for the requester (optional)", required "Reason"; buttons "Approve request" /
  "Reject request"). A request whose time is over is marked "Ended" and can only be rejected. Outcomes are announced
  in the page; a stale version ("This booking was changed in the meantime…") re-renders the list.
  `?booking=<id>` (admin notification links) highlights the request, or shows it under "From your notification" once
  decided.
- **All bookings**: filters "Status", "Resource" (rooms / equipment groups), "From" (default today; empty = no lower
  bound, newest first), "To" (inclusive), "Reset filters"; table "When", "Resource", "Requested by", "Purpose",
  "Status", "Actions" (`tr[data-booking-id][data-status]`; approve / reject / "Cancel booking"); server pagination.
- **Equipment**: table of every item (inactive ones too) with "Add equipment" and "Edit" (dialog: "Name",
  "Category", "Location", "Description", "Requires approval", "Active") and "Delete" (confirmation; `IN_USE` →
  "… still has 2 upcoming bookings, so it can't be deleted. Make it inactive instead.").
- **Statistics**: month navigation ("Previous month" / "Next month", `?month=YYYY-MM`), tiles "Requests", "Booked
  hours", "Average occupancy", "Requests by status", the chart "Occupancy by resource" (recharts horizontal bars, top
  10, primary token, value at the bar end, hover tooltip, a text summary as caption) and the table "Usage by resource"
  with every resource. The chart is rendered after hydration only (it measures the page).

## Conventions

- Mutations go through Server Actions (`serverApi`), reads through `useOfflineQuery` (user page) or Server Components
  (admin page). Expected 4xx answers never reach the browser's `fetch`.
- One `role="status"` / `role="alert"` per mounted section (only the active tab is mounted).
- Times are campus times (`lib/datetime`), the API receives ISO instants (`zonedTimeToUtc`).

## Checks

- `npx tsc --noEmit --incremental false`, `npm run lint`, `NEXT_DIST_DIR=.next-bookings npx next build`.
- A build into a reused `NEXT_DIST_DIR` can fail its type check on a stale `<dist>/cache/.tsbuildinfo` (route types
  of another layout set): delete the folder and build again.
- End-to-end (real backend + seed, `next start`): student, teacher, admin and alumni, FR / EN, desktop / mobile,
  light / dark, offline reading of "My bookings", no console error and no CSP violation.
