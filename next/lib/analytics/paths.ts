// Web paths and API paths of Module 9 (attendance, grades, student analytics).
import { addDays, isDateKey, todayKey, type DateKey } from "@/lib/datetime";
import type { Level } from "@/lib/analytics/types";

export const ANALYTICS_HREF = "/dashboard/analytics";
export const ATTENDANCE_HREF = "/dashboard/attendance";
export const GRADES_HREF = "/dashboard/grades";
export const FOLLOW_UP_HREF = "/dashboard/admin/analytics";

export const rollCallHref = (sessionId: string) => `${ATTENDANCE_HREF}/${encodeURIComponent(sessionId)}`;
export const gradeSheetHref = (assessmentId: string) => `${GRADES_HREF}/${encodeURIComponent(assessmentId)}`;
export const studentFollowUpHref = (studentId: string) => `${FOLLOW_UP_HREF}/students/${encodeURIComponent(studentId)}`;

/** API path (relative to /api, or /bff in the browser) of the student view. */
export const myAnalyticsPath = (compare = false) => `/analytics/me${compare ? "?compare=true" : ""}`;
export const studentAnalyticsPath = (studentId: string, compare = false) =>
  `/analytics/students/${encodeURIComponent(studentId)}${compare ? "?compare=true" : ""}`;

/** Download links (the BFF passes the PDF attachment through). Without `locale` the backend uses the student's. */
export function myReportUrl(locale?: string): string {
  return `/bff/analytics/me/report.pdf${locale ? `?locale=${encodeURIComponent(locale)}` : ""}`;
}
export function studentReportUrl(studentId: string, locale?: string): string {
  return `/bff/analytics/students/${encodeURIComponent(studentId)}/report.pdf${locale ? `?locale=${encodeURIComponent(locale)}` : ""}`;
}

/** Days shown by the session list of the attendance page (the backend allows up to 31). */
export const SESSION_LIST_DAYS = 7;

/**
 * Period of the session list: the SESSION_LIST_DAYS days ending on `end` (inclusive, campus timezone).
 * `?date=YYYY-MM-DD` picks the last day; default today. `to` is exclusive (API convention).
 */
export function sessionListRange(dateParam: string | undefined, today: DateKey = todayKey()) {
  const end = isDateKey(dateParam) ? dateParam : today;
  const from = addDays(end, -(SESSION_LIST_DAYS - 1));
  const to = addDays(end, 1);
  return { end, from, to, isCurrent: end >= today };
}

/** Badge variant of an absence level (components/ui/badge). */
export function levelVariant(level: Level): "success" | "warning" | "danger" {
  return level === "CRITICAL" ? "danger" : level === "WARNING" ? "warning" : "success";
}

/** Query string helper: drops empty values. */
export function buildQuery(values: Record<string, string | number | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}
