import "server-only";
import { getTranslations } from "next-intl/server";
import { toApiError } from "@/lib/api";
import { actionFailure, type ActionState } from "@/lib/server-api";
import type { ValidationErrors } from "@/lib/carpool/validation";

/** What a failed carpool action may hand back: `reload` when the trip changed meanwhile (fetch it again). */
export type CarpoolActionData = { reload?: boolean };

const RULES = ["IN_PAST", "TOO_FAR_AHEAD", "SAME_PLACE", "TOO_LONG", "SEATS_TAKEN"] as const;
type Rule = (typeof RULES)[number];

/** API field names -> form field names. */
const FIELD_NAMES: Record<string, string> = {
  departure: "place",
  destination: "place",
  departureAt: "date",
  pricePerSeat: "price",
  body: "body",
  seats: "seats",
  notes: "notes",
  message: "message",
  score: "score",
  rating: "score",
  comment: "comment",
  reason: "reason",
};

/** The rule's form field: a time in the past is about the time, a trip too far ahead about the date. */
const RULE_FIELDS: Record<Rule, string> = {
  IN_PAST: "time",
  TOO_FAR_AHEAD: "date",
  SAME_PLACE: "place",
  TOO_LONG: "place",
  SEATS_TAKEN: "seats",
};

/** Localised failed state of the browser-side checks (same keys as lib/carpool/validation). */
export async function validationFailure<T>(errors: ValidationErrors): Promise<ActionState<T>> {
  const t = await getTranslations("carpool.validation");
  const fieldErrors = Object.fromEntries(
    Object.entries(errors).flatMap(([field, error]) => (error ? [[field, t(error.key, error.values ?? {})]] : []))
  );
  return { ok: false, code: "VALIDATION_ERROR", message: [...new Set(Object.values(fieldErrors))].join(" "), fieldErrors, at: Date.now() };
}

/**
 * Backend error -> localised failed ActionState with the carpool wording (rules, seats, requests, chat,
 * ratings). 401 sends the user to /auth/expired (actionFailure).
 */
export async function carpoolFailure<T extends CarpoolActionData = CarpoolActionData>(error: unknown): Promise<ActionState<T>> {
  const failure = await actionFailure<T>(error);
  const apiError = toApiError(error);
  const details = (apiError.details && typeof apiError.details === "object" ? apiError.details : {}) as Record<string, unknown>;
  const t = await getTranslations("carpool.errors");
  const reload = { reload: true } as T;

  if (failure.fieldErrors) {
    failure.fieldErrors = Object.fromEntries(
      Object.entries(failure.fieldErrors)
        .filter(([field]) => field in FIELD_NAMES || field.startsWith("departure.") || field.startsWith("destination."))
        .map(([field, message]) => [FIELD_NAMES[field] ?? (field.startsWith("departureAt") ? "date" : "place"), message])
    );
  }

  switch (apiError.code) {
    case "VALIDATION_ERROR": {
      const rule = details.rule;
      if (typeof rule === "string" && (RULES as readonly string[]).includes(rule)) {
        const tRules = await getTranslations("carpool.rules");
        const message = tRules(rule as Rule, {
          days: typeof details.maxDaysAhead === "number" ? details.maxDaysAhead : 30,
          taken: typeof details.taken === "number" ? details.taken : 0,
        });
        failure.message = message;
        failure.fieldErrors = { [RULE_FIELDS[rule as Rule]]: message };
      }
      break;
    }
    case "TRIP_LIMIT_REACHED":
      failure.message = t("TRIP_LIMIT_REACHED", { limit: typeof details.limit === "number" ? details.limit : 5 });
      break;
    case "TRIP_FULL":
      failure.message = t("TRIP_FULL");
      failure.data = reload;
      break;
    case "ALREADY_REQUESTED":
      failure.message = details.reason === "LIMIT" ? t("REQUEST_LIMIT", { limit: typeof details.limit === "number" ? details.limit : 3 }) : t("ALREADY_REQUESTED");
      failure.data = reload;
      break;
    case "ALREADY_RATED":
      failure.message = t("ALREADY_RATED");
      failure.data = reload;
      break;
    case "INVALID_STATE": {
      const reason = details.reason;
      failure.message =
        reason === "DEPARTED"
          ? t("DEPARTED")
          : reason === "PRICE_LOCKED"
            ? t("PRICE_LOCKED")
            : reason === "TRIP_CANCELLED"
              ? t("TRIP_CANCELLED")
              : reason === "CHAT_CLOSED"
                ? t("CHAT_CLOSED")
                : reason === "TOO_EARLY"
                  ? t("TOO_EARLY")
                  : t("INVALID_STATE");
      failure.data = reload;
      break;
    }
    case "FORBIDDEN":
      failure.message = details.reason === "OWN_TRIP" ? t("OWN_TRIP") : t("FORBIDDEN");
      failure.data = reload;
      break;
    case "RESOURCE_NOT_FOUND":
      failure.message = t("NOT_FOUND");
      failure.data = reload;
      break;
    case "TOO_MANY_REQUESTS":
      failure.message = t("TOO_MANY_REQUESTS");
      break;
  }
  return failure;
}
