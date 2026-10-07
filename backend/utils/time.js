// Campus-timezone helpers (APP_TIMEZONE, default Africa/Tunis). Weeks start on Monday.
// Dates are stored and exchanged in UTC; these helpers convert between UTC instants and
// wall-clock values ("YYYY-MM-DD", "HH:mm") in the campus timezone, DST-safe via Intl.

const DEFAULT_TIMEZONE = 'Africa/Tunis';
const DAY_MS = 24 * 60 * 60 * 1000;

const getAppTimezone = () => {
  const value = (process.env.APP_TIMEZONE || '').trim();
  return value || DEFAULT_TIMEZONE;
};

const formatterCache = new Map();
const getFormatter = (timeZone) => {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
      })
    );
  }
  return formatterCache.get(timeZone);
};

const WEEKDAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

// Wall-clock parts of an instant in a timezone. weekday: 1 = Monday ... 7 = Sunday.
const getZonedParts = (date, timeZone = getAppTimezone()) => {
  const parts = {};
  getFormatter(timeZone)
    .formatToParts(new Date(date))
    .forEach(({ type, value }) => {
      parts[type] = value;
    });
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday],
  };
};

// Offset (ms) of the timezone at an instant: wall clock minus UTC.
const getTimezoneOffsetMs = (date, timeZone = getAppTimezone()) => {
  const p = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const instant = new Date(date).getTime();
  return asUtc - (instant - (instant % 1000));
};

// UTC instant of a wall-clock time in the timezone (month is 1..12).
// For a time skipped by a DST change, the result is shifted forward like most calendars do.
const zonedTimeToUtc = ({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone = getAppTimezone()) => {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = getTimezoneOffsetMs(guess, timeZone);
  let result = guess - firstOffset;
  const secondOffset = getTimezoneOffsetMs(result, timeZone);
  if (secondOffset !== firstOffset) result = guess - secondOffset;
  return new Date(result);
};

const pad = (value, length = 2) => String(value).padStart(length, '0');

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

// "YYYY-MM-DD" → { year, month, day }, or null when the date does not exist.
const parseDateOnly = (value) => {
  const match = DATE_RE.exec(String(value ?? '').trim());
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
};

// "HH:mm" (24 h) → { hour, minute }, or null.
const parseTimeOnly = (value) => {
  const match = TIME_RE.exec(String(value ?? '').trim());
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
};

// ("2026-10-08", "10:30") in the campus timezone → Date (UTC), or null when invalid.
const parseLocalDateTime = (dateString, timeString = '00:00', timeZone = getAppTimezone()) => {
  const date = parseDateOnly(dateString);
  const time = parseTimeOnly(timeString);
  if (!date || !time) return null;
  return zonedTimeToUtc({ ...date, ...time }, timeZone);
};

// Date → "YYYY-MM-DD" in the campus timezone.
const formatLocalDate = (date, timeZone = getAppTimezone()) => {
  const p = getZonedParts(date, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
};

// Date → "HH:mm" in the campus timezone.
const formatLocalTime = (date, timeZone = getAppTimezone()) => {
  const p = getZonedParts(date, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
};

// "YYYY-MM-DD" + n days → "YYYY-MM-DD" (calendar arithmetic, no timezone involved).
const addDaysToDateString = (dateString, days) => {
  const date = parseDateOnly(dateString);
  if (!date) return null;
  const result = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * DAY_MS);
  return `${pad(result.getUTCFullYear(), 4)}-${pad(result.getUTCMonth() + 1)}-${pad(result.getUTCDate())}`;
};

// Midnight (campus timezone) of the day containing `date`, as a UTC Date.
const startOfLocalDay = (date = new Date(), timeZone = getAppTimezone()) => {
  const p = getZonedParts(date, timeZone);
  return zonedTimeToUtc({ year: p.year, month: p.month, day: p.day }, timeZone);
};

// Monday 00:00 (campus timezone) of the week containing `date`, as a UTC Date.
const startOfLocalWeek = (date = new Date(), timeZone = getAppTimezone()) => {
  const p = getZonedParts(date, timeZone);
  const monday = addDaysToDateString(`${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`, 1 - p.weekday);
  return parseLocalDateTime(monday, '00:00', timeZone);
};

// Midnight (campus timezone) `days` calendar days after the local day of `date`.
const addLocalDays = (date, days, timeZone = getAppTimezone()) => {
  const next = addDaysToDateString(formatLocalDate(date, timeZone), days);
  return parseLocalDateTime(next, '00:00', timeZone);
};

const isSameLocalDay = (a, b, timeZone = getAppTimezone()) =>
  formatLocalDate(a, timeZone) === formatLocalDate(b, timeZone);

// Academic year "YYYY-YYYY" containing `date`: it starts in September.
const currentAcademicYear = (date = new Date(), timeZone = getAppTimezone()) => {
  const { year, month } = getZonedParts(date, timeZone);
  const startYear = month >= 9 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
};

// Bounds of the academic year containing `date`: { start, end } = 1 September 00:00 (campus timezone) of its
// first year and of the next year, as UTC Dates (end exclusive, i.e. the year runs until 31 August included).
const academicYearBounds = (date = new Date(), timeZone = getAppTimezone()) => {
  const startYear = Number(currentAcademicYear(date, timeZone).slice(0, 4));
  return {
    start: zonedTimeToUtc({ year: startYear, month: 9, day: 1 }, timeZone),
    end: zonedTimeToUtc({ year: startYear + 1, month: 9, day: 1 }, timeZone),
  };
};

module.exports = {
  DEFAULT_TIMEZONE,
  DAY_MS,
  getAppTimezone,
  getZonedParts,
  getTimezoneOffsetMs,
  zonedTimeToUtc,
  parseDateOnly,
  parseTimeOnly,
  parseLocalDateTime,
  formatLocalDate,
  formatLocalTime,
  addDaysToDateString,
  startOfLocalDay,
  startOfLocalWeek,
  addLocalDays,
  isSameLocalDay,
  currentAcademicYear,
  academicYearBounds,
};
