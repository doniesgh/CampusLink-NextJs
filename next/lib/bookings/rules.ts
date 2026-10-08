// Booking rules, time grid, availability helpers and URL state of the bookings pages (isomorphic: Server
// Components, Server Actions and Client Components). Mirrors the backend rules (backend/docs/bookings.md):
// 15-minute grid, same campus day, 07:00-21:00, in the future, at most 60 days ahead, at most 3 h for a
// student and 8 h for a teacher or an admin, at most 3 upcoming bookings for a student.
import { addDays, dateKey, isDateKey, startOfWeek, timeKey, todayKey, zonedTimeToUtc, type DateKey } from "@/lib/datetime";
import type { Role } from "@/lib/types";
import type { BusySlot, ResourceType } from "@/lib/bookings/types";

export const OPEN_TIME = "07:00";
export const CLOSE_TIME = "21:00";
export const SLOT_MINUTES = 15;
export const MAX_DAYS_AHEAD = 60;
export const STUDENT_MAX_HOURS = 3;
export const STAFF_MAX_HOURS = 8;
export const STUDENT_BOOKING_LIMIT = 3;
export const PURPOSE_MIN = 2;
export const PURPOSE_MAX = 300;
export const NOTE_MAX = 500;

const SLOT_MS = SLOT_MINUTES * 60_000;
const HOUR_MS = 60 * 60_000;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export function isObjectId(value: unknown): value is string {
  return typeof value === "string" && OBJECT_ID_RE.test(value);
}

export function maxHoursFor(role: Role | undefined): number {
  return role === "STUDENT" ? STUDENT_MAX_HOURS : STAFF_MAX_HOURS;
}

/** "08:30" -> 510 (minutes since midnight), NaN when malformed. */
export function minutesOf(time: string): number {
  const match = TIME_RE.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
}

export function timeOfMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function gridTimes(from: string, to: string): string[] {
  const times: string[] = [];
  for (let m = minutesOf(from); m <= minutesOf(to); m += SLOT_MINUTES) times.push(timeOfMinutes(m));
  return times;
}

/** Start times offered by the form: 07:00 ... 20:45. */
export const START_TIMES: readonly string[] = gridTimes(OPEN_TIME, timeOfMinutes(minutesOf(CLOSE_TIME) - SLOT_MINUTES));
/** End times offered by the form: 07:15 ... 21:00. */
export const END_TIMES: readonly string[] = gridTimes(timeOfMinutes(minutesOf(OPEN_TIME) + SLOT_MINUTES), CLOSE_TIME);

/** Rule codes of the backend (`details.rule` of 400 VALIDATION_ERROR), also used by the form's own checks. */
export type BookingRule =
  | "NOT_BOOKABLE"
  | "INACTIVE"
  | "END_BEFORE_START"
  | "TIME_GRID"
  | "SAME_DAY"
  | "OPENING_HOURS"
  | "IN_PAST"
  | "TOO_FAR_AHEAD"
  | "MAX_DURATION";
export const BOOKING_RULES: readonly BookingRule[] = [
  "NOT_BOOKABLE",
  "INACTIVE",
  "END_BEFORE_START",
  "TIME_GRID",
  "SAME_DAY",
  "OPENING_HOURS",
  "IN_PAST",
  "TOO_FAR_AHEAD",
  "MAX_DURATION",
];

export type TimeField = "date" | "start" | "end";
export type TimeProblems = Partial<Record<TimeField, BookingRule | "required">>;

/**
 * Checks a date + start/end campus times against the rules (first problem per field).
 *   checkBookingTimes({ date: "2026-10-09", start: "17:00", end: "19:00", role: "STUDENT", now: Date.now() })
 */
export function checkBookingTimes({
  date,
  start,
  end,
  role,
  now,
}: {
  date: string;
  start: string;
  end: string;
  role: Role | undefined;
  now: number;
}): TimeProblems {
  const problems: TimeProblems = {};
  if (!isDateKey(date)) problems.date = "required";
  const startMinutes = minutesOf(start);
  const endMinutes = minutesOf(end);
  if (Number.isNaN(startMinutes)) problems.start = "required";
  else if (startMinutes % SLOT_MINUTES !== 0) problems.start = "TIME_GRID";
  if (Number.isNaN(endMinutes)) problems.end = "required";
  else if (endMinutes % SLOT_MINUTES !== 0) problems.end = "TIME_GRID";
  if (problems.date || problems.start || problems.end) return problems;

  if (endMinutes <= startMinutes) return { end: "END_BEFORE_START" };
  if (startMinutes < minutesOf(OPEN_TIME)) return { start: "OPENING_HOURS" };
  if (endMinutes > minutesOf(CLOSE_TIME)) return { end: "OPENING_HOURS" };
  const startsAt = zonedTimeToUtc(date, start).getTime();
  if (startsAt <= now) return { start: "IN_PAST" };
  if (startsAt > now + MAX_DAYS_AHEAD * 24 * HOUR_MS) return { date: "TOO_FAR_AHEAD" };
  if ((endMinutes - startMinutes) / 60 > maxHoursFor(role)) return { end: "MAX_DURATION" };
  return {};
}

/** Last day that can be booked (input max). */
export function lastBookableDay(today: DateKey = todayKey()): DateKey {
  return addDays(today, MAX_DAYS_AHEAD);
}

/** Next quarter hour at or after `ms`. */
export function ceilToSlot(ms: number): number {
  return Math.ceil(ms / SLOT_MS) * SLOT_MS;
}

/**
 * A sensible first slot for the form: the next quarter hour today (one hour long), or tomorrow 08:00 when
 * today is (almost) over.
 */
export function suggestSlot(now: number): { date: DateKey; start: string; end: string } {
  const today = dateKey(now);
  const next = ceilToSlot(now + 5 * 60_000);
  const nextMinutes = minutesOf(timeKey(next));
  if (dateKey(next) === today && nextMinutes >= minutesOf(OPEN_TIME) && nextMinutes + 60 <= minutesOf(CLOSE_TIME)) {
    return { date: today, start: timeOfMinutes(nextMinutes), end: timeOfMinutes(nextMinutes + 60) };
  }
  const day = nextMinutes < minutesOf(OPEN_TIME) && dateKey(next) === today ? today : addDays(today, 1);
  return { date: day, start: "08:00", end: "09:00" };
}

/** End time after a new start: keeps the duration when possible (capped by the closing time and the max). */
export function keepDuration(start: string, previousStart: string, previousEnd: string, role: Role | undefined): string {
  const duration = minutesOf(previousEnd) - minutesOf(previousStart);
  const wanted = Number.isFinite(duration) && duration > 0 ? duration : 60;
  const capped = Math.min(wanted, maxHoursFor(role) * 60);
  return timeOfMinutes(Math.min(minutesOf(start) + capped, minutesOf(CLOSE_TIME)));
}

// ---------------------------------------------------------------- availability

export type Interval = { start: number; end: number };

/** Busy entries overlapping the campus day `day`, sorted by start. */
export function busyOnDay(busy: readonly BusySlot[], day: DateKey): BusySlot[] {
  const dayStart = zonedTimeToUtc(day, "00:00").getTime();
  const dayEnd = zonedTimeToUtc(addDays(day, 1), "00:00").getTime();
  return busy
    .filter((slot) => Date.parse(slot.startsAt) < dayEnd && Date.parse(slot.endsAt) > dayStart)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/** Opening hours of `day` as instants (ms). */
export function openingInterval(day: DateKey): Interval {
  return { start: zonedTimeToUtc(day, OPEN_TIME).getTime(), end: zonedTimeToUtc(day, CLOSE_TIME).getTime() };
}

/**
 * Free intervals of a day (opening hours minus busy times, from the next quarter hour when the day is today),
 * at least 15 minutes long.
 */
export function freeIntervals(day: DateKey, busy: readonly BusySlot[], now: number): Interval[] {
  const open = openingInterval(day);
  let cursor = Math.max(open.start, ceilToSlot(now));
  const result: Interval[] = [];
  for (const slot of busyOnDay(busy, day)) {
    const start = Math.max(Date.parse(slot.startsAt), open.start);
    const end = Math.min(Date.parse(slot.endsAt), open.end);
    if (start - cursor >= SLOT_MS) result.push({ start: cursor, end: Math.min(start, open.end) });
    cursor = Math.max(cursor, end);
  }
  if (open.end - cursor >= SLOT_MS) result.push({ start: cursor, end: open.end });
  return result.filter((interval) => interval.end - interval.start >= SLOT_MS);
}

/** Busy entries overlapping [start, end) of `date` (campus times). */
export function overlapping(busy: readonly BusySlot[], date: DateKey, start: string, end: string): BusySlot[] {
  const from = zonedTimeToUtc(date, start).getTime();
  const to = zonedTimeToUtc(date, end).getTime();
  if (!(to > from)) return [];
  return busy.filter((slot) => Date.parse(slot.startsAt) < to && Date.parse(slot.endsAt) > from);
}

/** Week shown by the availability views (Monday -> next Monday) and its offline query. */
export function availabilityRange(type: ResourceType, resource: string, date: DateKey) {
  const from = startOfWeek(date);
  const to = addDays(from, 7);
  const key = ["bookings", "availability", type, resource, from] as const;
  return {
    from,
    to,
    key,
    id: key.join(":"),
    path: `/bookings/availability?resourceType=${type}&resource=${resource}&from=${from}&to=${to}`,
  };
}

// ---------------------------------------------------------------- URL state of /dashboard/bookings

export type BookingsTab = "book" | "free" | "mine";
export const BOOKINGS_TABS: readonly BookingsTab[] = ["book", "free", "mine"];
export type AvailabilityView = "day" | "week";
export type MineScope = "upcoming" | "past";

export type BookingsUrlState = {
  tab: BookingsTab | null;
  type: ResourceType | null;
  resource: string | null;
  view: AvailabilityView | null;
  date: DateKey | null;
  scope: MineScope | null;
  booking: string | null;
};

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function readParam(source: ParamSource, name: string): string | null {
  if (source instanceof URLSearchParams) return source.get(name);
  const value = source[name];
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

export function parseBookingsParams(source: ParamSource): BookingsUrlState {
  const tab = readParam(source, "tab");
  const type = readParam(source, "type");
  const resource = readParam(source, "resource");
  const view = readParam(source, "view");
  const date = readParam(source, "date");
  const scope = readParam(source, "scope");
  const booking = readParam(source, "booking");
  return {
    tab: (BOOKINGS_TABS as readonly string[]).includes(tab ?? "") ? (tab as BookingsTab) : null,
    type: type === "ROOM" || type === "EQUIPMENT" ? type : null,
    resource: isObjectId(resource) ? resource : null,
    view: view === "day" || view === "week" ? view : null,
    date: isDateKey(date) ? date : null,
    scope: scope === "upcoming" || scope === "past" ? scope : null,
    booking: isObjectId(booking) ? booking : null,
  };
}

/** Canonical query string (no "?"), fixed order. */
export function bookingsQuery(state: Partial<BookingsUrlState>): string {
  const params = new URLSearchParams();
  const keys: (keyof BookingsUrlState)[] = ["tab", "type", "resource", "view", "date", "scope", "booking"];
  for (const key of keys) {
    const value = state[key];
    if (value) params.set(key, value);
  }
  return params.toString();
}

/** Own bookings query (offline-capable): one key per scope and page. */
export function myBookingsQuery(scope: MineScope, page: number, limit = 20) {
  const key = ["bookings", "me", scope, page] as const;
  return { key, id: key.join(":"), path: `/bookings/me?scope=${scope}&page=${page}&limit=${limit}` };
}
