"use server";

import { getTranslations } from "next-intl/server";
import { actionFailure, actionSuccess, serverApi, type ActionState } from "@/lib/server-api";
import { carpoolFailure, validationFailure, type CarpoolActionData } from "@/lib/carpool/server";
import { messagesPath, tripPath } from "@/lib/carpool/paths";
import { isObjectId, isTripDetail, type TripDetail, type TripMessage, type TripRequest } from "@/lib/carpool/types";
import {
  cleanText,
  hasErrors,
  validateChatMessage,
  validateOptionalText,
  validateRating,
  validateSeatRequest,
  validateTrip,
  type TripFormInput,
} from "@/lib/carpool/validation";

/*
 * Carpool mutations that can fail with an expected 4xx (docs: next/README.md "Data layer"): they run on the
 * server with serverApi(), so the browser never logs a failed request. The API checks the role (STUDENT) and
 * who may do what; the pages update their offline query with the returned trip (no server re-render).
 */

type TripResult = ActionState<CarpoolActionData & { trip?: TripDetail }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalidInput<T>(): Promise<ActionState<T>> {
  return actionFailure<T>(new Error("Invalid input"));
}

const fullName = (person: { firstname?: string; lastname?: string } | null | undefined) =>
  `${person?.firstname ?? ""} ${person?.lastname ?? ""}`.trim();

/** "Publish trip": POST /api/carpool/trips → the new trip's id (the page opens it). */
export async function createTripAction(input: TripFormInput): Promise<ActionState<CarpoolActionData & { id?: string }>> {
  const { errors, payload } = validateTrip(input, Date.now());
  if (!payload || hasErrors(errors)) return validationFailure(errors);
  try {
    const trip = await serverApi<TripDetail>("/carpool/trips", { method: "POST", body: payload });
    return actionSuccess(undefined, { data: { id: trip.id } });
  } catch (e) {
    return carpoolFailure(e);
  }
}

/** "Send request": POST /api/carpool/trips/:id/requests { seats, message? }. */
export async function requestSeatAction(tripId: string, input: { seats: number; message: string }): Promise<TripResult> {
  if (!isObjectId(tripId)) return invalidInput();
  const { errors, payload } = validateSeatRequest(input);
  if (!payload) return validationFailure(errors);
  try {
    const request = await serverApi<TripRequest & { trip?: TripDetail }>(`${tripPath(tripId)}/requests`, { method: "POST", body: payload });
    const t = await getTranslations("carpool.trip");
    return actionSuccess(t("requestSent"), { data: isTripDetail(request.trip) ? { trip: request.trip } : { reload: true } });
  } catch (e) {
    return carpoolFailure(e);
  }
}

/** Passenger: "Cancel my request" / "Give up my seat": POST /api/carpool/requests/:id/cancel. */
export async function cancelRequestAction(requestId: string): Promise<TripResult> {
  if (!isObjectId(requestId)) return invalidInput();
  try {
    const request = await serverApi<TripRequest & { trip?: TripDetail }>(`/carpool/requests/${requestId}/cancel`, { method: "POST" });
    const t = await getTranslations("carpool.trip");
    return actionSuccess(t("requestCancelled"), { data: isTripDetail(request.trip) ? { trip: request.trip } : { reload: true } });
  } catch (e) {
    return carpoolFailure(e);
  }
}

/** Driver: "Accept": POST /api/carpool/requests/:id/accept (never overbooks: 409 TRIP_FULL). */
export async function acceptRequestAction(requestId: string): Promise<TripResult> {
  if (!isObjectId(requestId)) return invalidInput();
  try {
    const request = await serverApi<TripRequest & { trip?: TripDetail }>(`/carpool/requests/${requestId}/accept`, { method: "POST" });
    const t = await getTranslations("carpool.requests");
    return actionSuccess(t("accepted", { name: fullName(request.passenger) }), {
      data: isTripDetail(request.trip) ? { trip: request.trip } : { reload: true },
    });
  } catch (e) {
    return carpoolFailure(e);
  }
}

/** Driver: "Decline request": POST /api/carpool/requests/:id/decline { message? }. */
export async function declineRequestAction(requestId: string, message: string): Promise<TripResult> {
  if (!isObjectId(requestId)) return invalidInput();
  const { error, text } = validateOptionalText(message, "decline");
  if (error) return validationFailure({ message: error });
  try {
    const request = await serverApi<TripRequest & { trip?: TripDetail }>(`/carpool/requests/${requestId}/decline`, {
      method: "POST",
      body: text ? { message: text } : {},
    });
    const t = await getTranslations("carpool.requests");
    return actionSuccess(t("declined", { name: fullName(request.passenger) }), {
      data: isTripDetail(request.trip) ? { trip: request.trip } : { reload: true },
    });
  } catch (e) {
    return carpoolFailure(e);
  }
}

/** Driver: "Cancel trip": POST /api/carpool/trips/:id/cancel { reason? } (the passengers are notified). */
export async function cancelTripAction(tripId: string, reason: string): Promise<TripResult> {
  if (!isObjectId(tripId)) return invalidInput();
  const { error, text } = validateOptionalText(reason, "cancel");
  if (error) return validationFailure({ reason: error });
  try {
    const trip = await serverApi<TripDetail>(`${tripPath(tripId)}/cancel`, { method: "POST", body: text ? { reason: text } : {} });
    const t = await getTranslations("carpool.trip");
    return actionSuccess(t("tripCancelled"), { data: isTripDetail(trip) ? { trip } : { reload: true } });
  } catch (e) {
    return carpoolFailure(e);
  }
}

/**
 * Chat: POST /api/carpool/trips/:id/messages { body, clientRequestId }. Idempotent: sending the same
 * clientRequestId again (retry after a network failure) returns the first message.
 */
export async function sendMessageAction(
  tripId: string,
  input: { body: string; clientRequestId: string }
): Promise<ActionState<CarpoolActionData & { message?: TripMessage }>> {
  if (!isObjectId(tripId) || typeof input?.clientRequestId !== "string" || !UUID_RE.test(input.clientRequestId)) return invalidInput();
  const problem = validateChatMessage(input.body);
  if (problem) return validationFailure({ body: problem });
  try {
    const message = await serverApi<TripMessage>(messagesPath(tripId).split("?")[0], {
      method: "POST",
      body: { body: cleanText(input.body), clientRequestId: input.clientRequestId },
    });
    return actionSuccess(undefined, { data: { message } });
  } catch (e) {
    return carpoolFailure(e);
  }
}

/** "Send rating": POST /api/carpool/trips/:id/ratings { userId, score, comment? }, then the updated trip. */
export async function rateParticipantAction(tripId: string, input: { userId: string; score: number; comment: string; name: string }): Promise<TripResult> {
  if (!isObjectId(tripId) || !isObjectId(input?.userId)) return invalidInput();
  const { errors, payload } = validateRating(input);
  if (!payload) return validationFailure(errors);
  try {
    await serverApi(`${tripPath(tripId)}/ratings`, { method: "POST", body: { userId: input.userId, ...payload } });
  } catch (e) {
    return carpoolFailure(e);
  }
  const t = await getTranslations("carpool.rating");
  const message = t("sent", { name: cleanText(input.name, { oneLine: true }).slice(0, 80) });
  try {
    const trip = await serverApi<TripDetail>(tripPath(tripId));
    return actionSuccess(message, { data: isTripDetail(trip) ? { trip } : { reload: true } });
  } catch {
    return actionSuccess(message, { data: { reload: true } });
  }
}
