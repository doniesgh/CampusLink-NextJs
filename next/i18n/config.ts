// Locale settings shared by the server (request config, Server Actions) and the client (switcher).
// No locale routing: the locale lives in the NEXT_LOCALE cookie (see i18n/request.ts).

export const LOCALES = ["fr", "en"] as const;
export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "fr";

/** Cookie holding the chosen locale ("fr" | "en"). Not secret, kept for a year. */
export const LOCALE_COOKIE = "NEXT_LOCALE";
export const LOCALE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/** Message namespaces: one JSON file per namespace in messages/<locale>/. */
export const NAMESPACES = [
  "common",
  "landing",
  "auth",
  "dashboard",
  "account",
  "admin",
  "notifications",
  "offline",
  "timetable",
  "announcements",
] as const;
export type Namespace = (typeof NAMESPACES)[number];

/** Campus timezone used for every displayed date/time and every "today"/"this week" range. */
export const APP_TIMEZONE = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Africa/Tunis";

export function isLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * First supported language of an Accept-Language header, honouring q-values
 * ("en-US,en;q=0.9,fr;q=0.8" -> "en"). Returns null when neither fr nor en is accepted.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): AppLocale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const quality = q ? Number.parseFloat(q.slice(2)) : 1;
      return { lang: tag.trim().toLowerCase().split("-")[0], quality: Number.isNaN(quality) ? 0 : quality, index };
    })
    .filter((entry) => entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const { lang } of ranked) {
    if (isLocale(lang)) return lang;
  }
  return null;
}

/** Resolution order of the contract: cookie -> Accept-Language -> fr. */
export function resolveLocale(cookieValue: string | null | undefined, acceptLanguage: string | null | undefined): AppLocale {
  if (isLocale(cookieValue)) return cookieValue;
  return localeFromAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}

/**
 * Date/time presets available to `format.dateTime(date, "<name>")` (next-intl) on the server and
 * in the browser. Times are always 24h ("08:30") in both languages; the campus timezone applies.
 */
export const formats = {
  dateTime: {
    /** 08:30 */
    time: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
    /** October 7, 2026 / 7 octobre 2026 */
    date: { day: "numeric", month: "long", year: "numeric" },
    /** Oct 7 / 7 oct. */
    dayMonth: { day: "numeric", month: "short" },
    /** Tue, Oct 8 / mar. 8 oct. */
    weekdayDayMonth: { weekday: "short", day: "numeric", month: "short" },
    /** Tuesday, October 8 / mardi 8 octobre */
    weekdayLong: { weekday: "long", day: "numeric", month: "long" },
    /** Oct 7, 2026, 10:42 / 7 oct. 2026, 10:42 */
    dateTime: { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
    /** Oct 7, 10:42 / 7 oct., 10:42 */
    dayMonthTime: { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  },
  number: {
    percent: { style: "percent", maximumFractionDigits: 0 },
  },
} as const;
