import "server-only";
import { getFormatter, getTranslations } from "next-intl/server";
import { toApiError } from "@/lib/api";
import { formatTimeRange } from "@/lib/datetime";
import { actionFailure, type ActionState } from "@/lib/server-api";
import { BOOKING_RULES, MAX_DAYS_AHEAD, STUDENT_BOOKING_LIMIT, type BookingRule } from "@/lib/bookings/rules";
import type { BookingConflict } from "@/lib/bookings/types";

/** Data that booking actions can hand back to the form (409 BOOKING_CONFLICT: the times in the way). */
export type BookingActionData = { conflicts?: BookingConflict[]; reload?: boolean };

/** Backend field names -> form field names. */
const FIELD_NAMES: Record<string, string> = { startsAt: "start", endsAt: "end", room: "resource", equipment: "resource" };

/** "Fri, Oct 9, 16:30–18:30" in the user's language and the campus timezone (Server Actions). */
export async function bookingWhen(startsAt: string, endsAt: string): Promise<string> {
  const [format, t] = await Promise.all([getFormatter(), getTranslations("bookings.format")]);
  return t("when", { day: format.dateTime(new Date(startsAt), "weekdayDayMonth"), range: formatTimeRange(startsAt, endsAt) });
}

/**
 * Localised failed ActionState for the bookings API errors: rule violations (details.rule), conflicts,
 * the student limit, optimistic locking (VERSION_CONFLICT -> `data.reload`) and invalid states.
 * Anything else falls back to actionFailure() (401 -> /auth/expired).
 */
export async function bookingFailure(error: unknown): Promise<ActionState<BookingActionData>> {
  const failure = await actionFailure<BookingActionData>(error);
  const apiError = toApiError(error);
  const details = (apiError.details && typeof apiError.details === "object" ? apiError.details : {}) as Record<string, unknown>;
  const t = await getTranslations("bookings");

  if (failure.fieldErrors) {
    failure.fieldErrors = Object.fromEntries(
      Object.entries(failure.fieldErrors)
        .filter(([field]) => field !== "rule" && field !== "maxHours" && field !== "maxDaysAhead")
        .map(([field, message]) => [FIELD_NAMES[field] ?? field, message])
    );
  }

  switch (apiError.code) {
    case "VALIDATION_ERROR": {
      const rule = details.rule;
      if (typeof rule === "string" && (BOOKING_RULES as readonly string[]).includes(rule)) {
        const message = t(`rules.${rule as BookingRule}`, {
          maxHours: typeof details.maxHours === "number" ? details.maxHours : 3,
          maxDaysAhead: typeof details.maxDaysAhead === "number" ? details.maxDaysAhead : MAX_DAYS_AHEAD,
        });
        const field = Object.keys(details).find((key) => key in FIELD_NAMES || key === "purpose");
        failure.message = message;
        failure.fieldErrors = field ? { [FIELD_NAMES[field] ?? field]: message } : {};
      }
      break;
    }
    case "BOOKING_CONFLICT":
      failure.message = t("errors.BOOKING_CONFLICT");
      failure.data = { conflicts: Array.isArray(details.conflicts) ? (details.conflicts as BookingConflict[]) : [] };
      break;
    case "BOOKING_LIMIT_REACHED":
      failure.message = t("errors.BOOKING_LIMIT_REACHED", {
        limit: typeof details.limit === "number" ? details.limit : STUDENT_BOOKING_LIMIT,
      });
      break;
    case "VERSION_CONFLICT":
      failure.message = t("errors.VERSION_CONFLICT");
      failure.data = { reload: true };
      break;
    case "INVALID_STATE":
      failure.message =
        details.reason === "STARTED" ? t("errors.STARTED") : details.reason === "ENDED" ? t("errors.ENDED") : t("errors.INVALID_STATE");
      failure.data = { reload: true };
      break;
    case "RESOURCE_NOT_FOUND":
      failure.message = t("errors.NOT_FOUND");
      failure.data = { reload: true };
      break;
    case "FORBIDDEN":
      failure.message = t("errors.FORBIDDEN");
      break;
  }
  return failure;
}
