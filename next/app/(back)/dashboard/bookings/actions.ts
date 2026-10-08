"use server";

import { getTranslations } from "next-intl/server";
import { zonedTimeToUtc } from "@/lib/datetime";
import { requireRole } from "@/lib/dal";
import { checkBookingTimes, isObjectId, PURPOSE_MAX, PURPOSE_MIN, maxHoursFor, MAX_DAYS_AHEAD } from "@/lib/bookings/rules";
import { bookingFailure, bookingWhen, type BookingActionData } from "@/lib/bookings/server";
import { bookingResourceName, type Booking, type ResourceType } from "@/lib/bookings/types";
import { actionFailure, actionSuccess, serverApi, type ActionState } from "@/lib/server-api";

/** Values of the booking form (date "YYYY-MM-DD", times "HH:mm", campus time). */
export type BookingFormValues = {
  resourceType: ResourceType;
  resource: string;
  date: string;
  start: string;
  end: string;
  purpose: string;
};

export type CreateBookingState = ActionState<BookingActionData & { booking?: Booking }>;
export type CancelBookingState = ActionState<BookingActionData & { booking?: Booking }>;

function failed(message: string, fieldErrors: Record<string, string>): CreateBookingState {
  return { ok: false, message, fieldErrors, at: Date.now() };
}

/**
 * "Book" / "Send request": POST /api/bookings. The rules are checked here first (same as the form), then by
 * the API: 400 VALIDATION_ERROR (details.rule), 409 BOOKING_CONFLICT (data.conflicts), 409 BOOKING_LIMIT_REACHED.
 */
export async function createBookingAction(values: BookingFormValues): Promise<CreateBookingState> {
  const { user, error } = await requireRole(["STUDENT", "TEACHER", "ADMIN"]);
  if (!user) return actionFailure(error);
  const t = await getTranslations("bookings");

  const resourceType: ResourceType | null = values?.resourceType === "ROOM" || values?.resourceType === "EQUIPMENT" ? values.resourceType : null;
  const date = String(values?.date ?? "");
  const start = String(values?.start ?? "");
  const end = String(values?.end ?? "");
  const purpose = String(values?.purpose ?? "").trim();

  const fieldErrors: Record<string, string> = {};
  if (!resourceType || !isObjectId(values?.resource)) fieldErrors.resource = t("form.noResource");
  const problems = checkBookingTimes({ date, start, end, role: user.role, now: Date.now() });
  for (const [field, rule] of Object.entries(problems)) {
    fieldErrors[field] =
      rule === "required" ? t("rules.required") : t(`rules.${rule}`, { maxHours: maxHoursFor(user.role), maxDaysAhead: MAX_DAYS_AHEAD });
  }
  if (purpose.length < PURPOSE_MIN) fieldErrors.purpose = t("form.purposeRequired", { min: PURPOSE_MIN });
  else if (purpose.length > PURPOSE_MAX) fieldErrors.purpose = t("form.purposeTooLong", { max: PURPOSE_MAX });
  if (Object.keys(fieldErrors).length > 0) return failed([...new Set(Object.values(fieldErrors))].join(" "), fieldErrors);

  let booking: Booking;
  try {
    booking = await serverApi<Booking>("/bookings", {
      method: "POST",
      body: {
        resourceType,
        [resourceType === "ROOM" ? "room" : "equipment"]: values.resource,
        startsAt: zonedTimeToUtc(date, start).toISOString(),
        endsAt: zonedTimeToUtc(date, end).toISOString(),
        purpose,
      },
    });
  } catch (e) {
    return bookingFailure(e);
  }

  const params = { resource: bookingResourceName(booking), when: await bookingWhen(booking.startsAt, booking.endsAt) };
  return actionSuccess(booking.status === "PENDING" ? t("form.requested", params) : t("form.confirmed", params), {
    data: { booking },
  });
}

/** "Confirm cancellation" of one's own booking: POST /api/bookings/:id/cancel { version }. */
export async function cancelBookingAction(id: string, version: number): Promise<CancelBookingState> {
  const { user, error } = await requireRole(["STUDENT", "TEACHER", "ADMIN"]);
  if (!user) return actionFailure(error);
  if (!isObjectId(id) || !Number.isInteger(version) || version < 0) return actionFailure(new Error("invalid booking"));

  let booking: Booking;
  try {
    booking = await serverApi<Booking>(`/bookings/${id}/cancel`, { method: "POST", body: { version } });
  } catch (e) {
    return bookingFailure(e);
  }
  const t = await getTranslations("bookings.mine");
  return actionSuccess(t("cancelled", { resource: bookingResourceName(booking), when: await bookingWhen(booking.startsAt, booking.endsAt) }), {
    data: { booking },
  });
}
