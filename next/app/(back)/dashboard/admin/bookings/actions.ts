"use server";

import { refresh } from "next/cache";
import { getTranslations } from "next-intl/server";
import { toApiError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { actionFailure, actionSuccess, serverApi, type ActionState } from "@/lib/server-api";
import { formText } from "@/lib/validation";
import { isObjectId, NOTE_MAX } from "@/lib/bookings/rules";
import { bookingFailure, bookingWhen, type BookingActionData } from "@/lib/bookings/server";
import { bookingResourceName, EQUIPMENT_CATEGORIES, type Booking, type Equipment, type EquipmentCategory } from "@/lib/bookings/types";

export type DecisionState = ActionState<BookingActionData>;

const NAME_MAX = 100;
const LOCATION_MAX = 200;
const DESCRIPTION_MAX = 1000;

async function ensureAdmin(): Promise<ActionState | null> {
  const { user, error } = await requireRole(["ADMIN"], "/dashboard/admin/bookings");
  return user ? null : actionFailure(error);
}

function validDecision(id: string, version: number): boolean {
  return isObjectId(id) && Number.isInteger(version) && version >= 0;
}

/** After a stale version or an invalid state the page is rendered again with the current bookings. */
async function decisionFailure(error: unknown): Promise<DecisionState> {
  const failure = await bookingFailure(error);
  if (failure.data?.reload) refresh();
  return failure;
}

async function successMessage(key: "approved" | "rejected" | "cancelled", booking: Booking): Promise<string> {
  const t = await getTranslations("bookings.admin.decision");
  return t(key, { resource: bookingResourceName(booking), when: await bookingWhen(booking.startsAt, booking.endsAt) });
}

/** "Approve request": POST /api/bookings/:id/approve { version, note? } (VERSION_CONFLICT when someone was faster). */
export async function approveBookingAction(id: string, version: number, note: string): Promise<DecisionState> {
  const denied = await ensureAdmin();
  if (denied) return denied;
  if (!validDecision(id, version)) return actionFailure(new Error("invalid booking"));
  const text = String(note ?? "").trim();
  if (text.length > NOTE_MAX) {
    const t = await getTranslations("bookings.admin.decision");
    const message = t("noteTooLong", { max: NOTE_MAX });
    return { ok: false, message, fieldErrors: { note: message }, at: Date.now() };
  }

  let booking: Booking;
  try {
    booking = await serverApi<Booking>(`/bookings/${id}/approve`, { method: "POST", body: text ? { version, note: text } : { version } });
  } catch (e) {
    return decisionFailure(e);
  }
  refresh();
  return actionSuccess(await successMessage("approved", booking));
}

/** "Reject request": POST /api/bookings/:id/reject { version, note } (the reason is required). */
export async function rejectBookingAction(id: string, version: number, note: string): Promise<DecisionState> {
  const denied = await ensureAdmin();
  if (denied) return denied;
  if (!validDecision(id, version)) return actionFailure(new Error("invalid booking"));
  const text = String(note ?? "").trim();
  if (!text || text.length > NOTE_MAX) {
    const t = await getTranslations("bookings.admin.decision");
    const message = text ? t("noteTooLong", { max: NOTE_MAX }) : t("reasonRequired");
    return { ok: false, message, fieldErrors: { note: message }, at: Date.now() };
  }

  let booking: Booking;
  try {
    booking = await serverApi<Booking>(`/bookings/${id}/reject`, { method: "POST", body: { version, note: text } });
  } catch (e) {
    return decisionFailure(e);
  }
  refresh();
  return actionSuccess(await successMessage("rejected", booking));
}

/** "Confirm cancellation" of any booking by an admin (the owner is notified by the API). */
export async function adminCancelBookingAction(id: string, version: number): Promise<DecisionState> {
  const denied = await ensureAdmin();
  if (denied) return denied;
  if (!validDecision(id, version)) return actionFailure(new Error("invalid booking"));

  let booking: Booking;
  try {
    booking = await serverApi<Booking>(`/bookings/${id}/cancel`, { method: "POST", body: { version } });
  } catch (e) {
    return decisionFailure(e);
  }
  refresh();
  return actionSuccess(await successMessage("cancelled", booking));
}

/** Add / edit dialog of the equipment tab: POST or PATCH /api/resources/equipment[/:id]. */
export async function saveEquipmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const denied = await ensureAdmin();
  if (denied) return denied;
  const t = await getTranslations("bookings.admin.equipment");

  const id = formText(formData, "id");
  if (id && !isObjectId(id)) return actionFailure(new Error("invalid equipment"));
  const values = {
    name: formText(formData, "name").trim(),
    category: formText(formData, "category").trim(),
    location: formText(formData, "location").trim(),
    description: formText(formData, "description").trim(),
    requiresApproval: formData.get("requiresApproval") === "on" ? "on" : "",
    active: formData.get("active") === "on" ? "on" : "",
  };

  const fieldErrors: Record<string, string> = {};
  if (!values.name) fieldErrors.name = t("nameRequired");
  else if (values.name.length > NAME_MAX) fieldErrors.name = t("tooLong", { max: NAME_MAX });
  if (!EQUIPMENT_CATEGORIES.includes(values.category as EquipmentCategory)) fieldErrors.category = t("categoryRequired");
  if (values.location.length > LOCATION_MAX) fieldErrors.location = t("tooLong", { max: LOCATION_MAX });
  if (values.description.length > DESCRIPTION_MAX) fieldErrors.description = t("tooLong", { max: DESCRIPTION_MAX });
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, message: Object.values(fieldErrors).join(" "), fieldErrors, values, at: Date.now() };
  }

  const body = {
    name: values.name,
    category: values.category,
    location: values.location,
    description: values.description,
    requiresApproval: values.requiresApproval === "on",
    active: values.active === "on",
  };
  let saved: Equipment;
  try {
    saved = await serverApi<Equipment>(`/resources/equipment${id ? `/${id}` : ""}`, { method: id ? "PATCH" : "POST", body });
  } catch (e) {
    const failure = await actionFailure(e, { values });
    if (failure.code === "ALREADY_EXISTS") {
      failure.message = t("nameTaken", { name: values.name });
      failure.fieldErrors = { name: failure.message };
    }
    return failure;
  }
  refresh();
  return actionSuccess(t("saved", { name: saved.name }));
}

/** "Confirm delete" of an item: 409 IN_USE while it has upcoming bookings (details.references.bookings). */
export async function deleteEquipmentAction(id: string, name: string): Promise<ActionState> {
  const denied = await ensureAdmin();
  if (denied) return denied;
  if (!isObjectId(id)) return actionFailure(new Error("invalid equipment"));
  const t = await getTranslations("bookings.admin.equipment");

  try {
    await serverApi(`/resources/equipment/${id}`, { method: "DELETE" });
  } catch (e) {
    const failure = await actionFailure(e);
    if (failure.code === "IN_USE") {
      const references = (toApiError(e).details as { references?: { bookings?: unknown } } | undefined)?.references;
      const count = typeof references?.bookings === "number" ? references.bookings : 1;
      failure.message = t("inUse", { name, count });
    }
    if (failure.code === "RESOURCE_NOT_FOUND") refresh();
    return failure;
  }
  refresh();
  return actionSuccess(t("deleted", { name }));
}
