// Timetable periods and URL state (isomorphic: Server Components, Client Components).
// Every date here is a campus calendar day ("YYYY-MM-DD", see lib/datetime.ts).
import { addDays, dateKey, isDateKey, startOfMonth, startOfWeek, zonedTimeToUtc, type DateKey } from "@/lib/datetime";
import type { ClassSession } from "@/lib/timetable/types";

export type TimetableView = "day" | "week" | "month";
export const TIMETABLE_VIEWS: readonly TimetableView[] = ["day", "week", "month"];

export function isTimetableView(value: unknown): value is TimetableView {
  return typeof value === "string" && (TIMETABLE_VIEWS as readonly string[]).includes(value);
}

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export function isObjectId(value: unknown): value is string {
  return typeof value === "string" && OBJECT_ID_RE.test(value);
}

/** What the URL says (`?view=&date=&subject=&teacher=`); null = not given (defaults apply). */
export type TimetableUrlState = {
  view: TimetableView | null;
  date: DateKey | null;
  subject: string | null;
  teacher: string | null;
};

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function readParam(source: ParamSource, name: string): string | null {
  if (source instanceof URLSearchParams) return source.get(name);
  const value = source[name];
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/** Validated URL state: unknown values are ignored. */
export function parseTimetableParams(source: ParamSource): TimetableUrlState {
  const view = readParam(source, "view");
  const date = readParam(source, "date");
  const subject = readParam(source, "subject");
  const teacher = readParam(source, "teacher");
  return {
    view: isTimetableView(view) ? view : null,
    date: isDateKey(date) ? date : null,
    subject: isObjectId(subject) ? subject : null,
    teacher: isObjectId(teacher) ? teacher : null,
  };
}

/** Canonical query string (no "?"), in a fixed order: "view=week&date=2026-10-07". */
export function timetableQuery(state: Partial<TimetableUrlState>): string {
  const params = new URLSearchParams();
  if (state.view) params.set("view", state.view);
  if (state.date) params.set("date", state.date);
  if (state.subject) params.set("subject", state.subject);
  if (state.teacher) params.set("teacher", state.teacher);
  return params.toString();
}

/** Calendar days [from, to). */
export function daysBetween(from: DateKey, to: DateKey): DateKey[] {
  const days: DateKey[] = [];
  for (let day = from; day < to && days.length < 62; day = addDays(day, 1)) days.push(day);
  return days;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "2026-01-31" + 1 month -> "2026-02-28" (day clamped to the month length). */
export function addMonths(day: DateKey, amount: number): DateKey {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7)) - 1 + amount;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const date = Math.min(Number(day.slice(8, 10)), daysInMonth(targetYear, targetMonth + 1));
  return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
}

/** Previous / next period of the view. */
export function shiftDate(view: TimetableView, day: DateKey, direction: -1 | 1): DateKey {
  if (view === "day") return addDays(day, direction);
  if (view === "week") return addDays(day, 7 * direction);
  return addMonths(day, direction);
}

/** Days shown by the month grid: whole weeks (Monday first) around the month of `day`. */
export function monthGrid(day: DateKey): { from: DateKey; to: DateKey; month: string } {
  const first = startOfMonth(day);
  const nextMonth = addMonths(first, 1);
  const from = startOfWeek(first);
  const to = addDays(startOfWeek(addDays(nextMonth, -1)), 7);
  return { from, to, month: first.slice(0, 7) };
}

/**
 * Data needed to show `view` at `day`: the day and week views share the week's data (Monday ->
 * next Monday), the month view loads its whole grid (at most 6 weeks, under the API's 62 days).
 * `key` / `id` identify the offline query (IndexedDB), `path` is the API path (relative to /api).
 */
export type TimetableRange = {
  kind: "week" | "month";
  from: DateKey;
  to: DateKey;
  key: readonly string[];
  id: string;
  path: string;
};

export function myTimetableRange(view: TimetableView, day: DateKey): TimetableRange {
  const kind = view === "month" ? "month" : "week";
  const { from, to } = kind === "month" ? monthGrid(day) : { from: startOfWeek(day), to: addDays(startOfWeek(day), 7) };
  const key = ["timetable", "me", kind, from] as const;
  return { kind, from, to, key, id: key.join(":"), path: `/timetable/me?from=${from}&to=${to}` };
}

/** The current week's data (dashboard widget; same query as the timetable page's week). */
export function currentWeekRange(today: DateKey): TimetableRange {
  return myTimetableRange("week", today);
}

/** Instant at noon of a campus day: format it with next-intl to display the day itself. */
export function dayToDate(day: DateKey): Date {
  return zonedTimeToUtc(day, "12:00");
}

/** Sessions grouped by campus day (sessions never span two days), each list sorted by start. */
export function groupByDay(sessions: readonly ClassSession[]): Map<DateKey, ClassSession[]> {
  const byDay = new Map<DateKey, ClassSession[]>();
  for (const session of sessions) {
    const day = dateKey(session.startsAt);
    const list = byDay.get(day);
    if (list) list.push(session);
    else byDay.set(day, [session]);
  }
  for (const list of byDay.values()) list.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return byDay;
}

/** Monday..Friday, plus Saturday/Sunday when a session falls on them. */
export function weekDays(monday: DateKey, sessionsByDay: Map<DateKey, unknown[]>): DateKey[] {
  const days = daysBetween(monday, addDays(monday, 7));
  return days.filter((day, index) => index < 5 || (sessionsByDay.get(day)?.length ?? 0) > 0);
}

/**
 * Google Calendar "add by URL" link for a calendar feed (webcal:// so Google subscribes to it).
 *   https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fapi.example.com%2F...
 */
export function googleCalendarUrl(feedUrl: string): string {
  const webcal = feedUrl.replace(/^https?:\/\//i, "webcal://");
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
}
