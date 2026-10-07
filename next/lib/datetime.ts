// Campus-timezone date helpers (server and browser). The backend stores UTC ISO strings; everything
// shown or typed by users is in APP_TIMEZONE (NEXT_PUBLIC_APP_TIMEZONE, default Africa/Tunis).
// Weeks start on Monday. Display formatting: prefer next-intl (`format.dateTime(date, "time")`, presets
// in i18n/config.ts), which already uses the campus timezone.
import { APP_TIMEZONE } from "@/i18n/config";

export { APP_TIMEZONE };

/** "YYYY-MM-DD" */
export type DateKey = string;

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

function parts(date: Date, timeZone: string) {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(formatted.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Calendar day of an instant in the campus timezone: "2026-10-08". */
export function dateKey(value: Date | string | number, timeZone = APP_TIMEZONE): DateKey {
  const p = parts(toDate(value), timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Wall-clock time of an instant in the campus timezone: "08:30". */
export function timeKey(value: Date | string | number, timeZone = APP_TIMEZONE): string {
  const p = parts(toDate(value), timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Today in the campus timezone. */
export function todayKey(timeZone = APP_TIMEZONE): DateKey {
  return dateKey(new Date(), timeZone);
}

/** Offset of the timezone from UTC at that instant, in minutes (Africa/Tunis: +60). */
export function timeZoneOffsetMinutes(value: Date, timeZone = APP_TIMEZONE): number {
  const p = parts(value, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(value.getTime() / 1000) * 1000) / 60_000);
}

/**
 * Instant of a campus wall-clock time: zonedTimeToUtc("2026-10-08", "08:30") -> Date (07:30Z in Tunis).
 * Use it to turn <input type="date"> + <input type="time"> values into ISO strings for the API.
 */
export function zonedTimeToUtc(day: DateKey, time = "00:00", timeZone = APP_TIMEZONE): Date {
  const d = DATE_KEY_RE.exec(day);
  const t = TIME_RE.exec(time);
  if (!d || !t) return new Date(Number.NaN);
  const guess = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  let result = guess - timeZoneOffsetMinutes(new Date(guess), timeZone) * 60_000;
  // Second pass for instants close to a DST change.
  result = guess - timeZoneOffsetMinutes(new Date(result), timeZone) * 60_000;
  return new Date(result);
}

/** "2026-10-08" + 3 -> "2026-10-11" (pure calendar arithmetic). */
export function addDays(day: DateKey, amount: number): DateKey {
  const d = DATE_KEY_RE.exec(day);
  if (!d) return day;
  const date = new Date(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]) + amount));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayIndex(day: DateKey): number {
  const d = DATE_KEY_RE.exec(day);
  if (!d) return 0;
  return (new Date(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]))).getUTCDay() + 6) % 7;
}

/** Monday of the week containing `day`. */
export function startOfWeek(day: DateKey): DateKey {
  return addDays(day, -weekdayIndex(day));
}

/** First day of the month containing `day`. */
export function startOfMonth(day: DateKey): DateKey {
  return `${day.slice(0, 7)}-01`;
}

export function isDateKey(value: unknown): value is DateKey {
  return typeof value === "string" && DATE_KEY_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** "08:30–10:00" in the campus timezone (24h, en dash), whatever the locale. */
export function formatTimeRange(start: Date | string | number, end: Date | string | number, timeZone = APP_TIMEZONE): string {
  return `${timeKey(start, timeZone)}–${timeKey(end, timeZone)}`;
}
