// Form checks shared by the browser (before sending) and the Server Actions (before calling the API).
// Errors are message keys of `carpool.validation` (+ values), translated where they are shown.
import { isDateKey, zonedTimeToUtc } from "@/lib/datetime";
import { haversineKm, type LatLng } from "@/lib/carpool/geo";
import {
  CANCEL_REASON_MAX,
  DECLINE_MESSAGE_MAX,
  DEFAULT_SETTINGS,
  DIRECTIONS,
  LABEL_MAX,
  MESSAGE_MAX,
  NOTES_MAX,
  PREFERENCE_KEYS,
  RATING_COMMENT_MAX,
  REQUEST_MESSAGE_MAX,
  type CarpoolSettings,
  type Direction,
  type TripPreferences,
} from "@/lib/carpool/types";

export type ValidationKey =
  | "placeRequired"
  | "samePlace"
  | "labelTooLong"
  | "dateRequired"
  | "timeRequired"
  | "inPast"
  | "tooFarAhead"
  | "seatsRange"
  | "priceRange"
  | "notesTooLong"
  | "messageTooLong"
  | "messageRequired"
  | "scoreRequired"
  | "commentTooLong"
  | "reasonTooLong";

export type ValidationError = { key: ValidationKey; values?: Record<string, number> };
export type ValidationErrors = Partial<Record<string, ValidationError>>;

export const hasErrors = (errors: ValidationErrors) => Object.keys(errors).length > 0;

/** Trimmed text; `oneLine` folds line breaks and runs of spaces (labels). */
export function cleanText(value: unknown, { oneLine = false }: { oneLine?: boolean } = {}): string {
  const text = typeof value === "string" ? value : "";
  return (oneLine ? text.replace(/\s+/g, " ") : text.replace(/\r\n?/g, "\n")).trim();
}

export type TripFormInput = {
  direction: string;
  /** The off-campus end: a curated place or the driver's position. */
  place: (LatLng & { label?: string }) | null;
  /** Optional precise meeting point, replaces the place's name. */
  meetingPoint: string;
  date: string;
  time: string;
  seats: number | string;
  /** "" = let the API use the suggested shared cost. */
  price: string;
  preferences: Partial<TripPreferences>;
  notes: string;
};

export type TripPayload = {
  direction: Direction;
  departure?: { label?: string; lat: number; lng: number };
  destination?: { label?: string; lat: number; lng: number };
  departureAt: string;
  seats: number;
  pricePerSeat?: number;
  preferences: TripPreferences;
  notes: string;
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const PRICE_RE = /^\d{1,2}([.,]\d{1,3})?$/;

const isCoordinate = (value: unknown, max: number): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= max;

/**
 * Checks the "Offer a trip" form; `payload` is the API body when there is no error. `campus` (from the API's
 * settings) enables the "too close to the campus" check; the Server Action leaves it to the API.
 */
export function validateTrip(
  input: TripFormInput,
  now: number,
  settings: Pick<CarpoolSettings, "maxSeats" | "minSeats" | "maxPricePerSeat" | "maxDaysAhead"> = DEFAULT_SETTINGS,
  campus: LatLng | null = null
): { errors: ValidationErrors; payload: TripPayload | null } {
  const errors: ValidationErrors = {};
  const direction: Direction = (DIRECTIONS as readonly string[]).includes(input?.direction) ? (input.direction as Direction) : "TO_CAMPUS";

  const place = input?.place;
  const validPlace = place && isCoordinate(place.lat, 90) && isCoordinate(place.lng, 180) ? place : null;
  if (!validPlace) errors.place = { key: "placeRequired" };
  else if (campus && haversineKm(validPlace, campus) < 0.5) errors.place = { key: "samePlace" };

  const meetingPoint = cleanText(input?.meetingPoint, { oneLine: true });
  if (meetingPoint.length > LABEL_MAX) errors.meetingPoint = { key: "labelTooLong", values: { max: LABEL_MAX } };

  const date = String(input?.date ?? "");
  const time = String(input?.time ?? "");
  let departureAt: Date | null = null;
  if (!isDateKey(date)) errors.date = { key: "dateRequired" };
  if (!TIME_RE.test(time)) errors.time = { key: "timeRequired" };
  if (!errors.date && !errors.time) {
    departureAt = zonedTimeToUtc(date, time);
    if (departureAt.getTime() <= now) errors.time = { key: "inPast" };
    else if (departureAt.getTime() > now + settings.maxDaysAhead * 86_400_000) {
      errors.date = { key: "tooFarAhead", values: { days: settings.maxDaysAhead } };
    }
  }

  const seats = Number(input?.seats);
  if (!Number.isInteger(seats) || seats < settings.minSeats || seats > settings.maxSeats) {
    errors.seats = { key: "seatsRange", values: { min: settings.minSeats, max: settings.maxSeats } };
  }

  const priceText = String(input?.price ?? "").trim();
  let price: number | undefined;
  if (priceText !== "") {
    price = Number(priceText.replace(",", "."));
    if (!PRICE_RE.test(priceText) || !Number.isFinite(price) || price < 0 || price > settings.maxPricePerSeat) {
      errors.price = { key: "priceRange", values: { max: settings.maxPricePerSeat } };
    }
  }

  const notes = cleanText(input?.notes);
  if (notes.length > NOTES_MAX) errors.notes = { key: "notesTooLong", values: { max: NOTES_MAX } };

  if (hasErrors(errors) || !validPlace || !departureAt) return { errors, payload: null };

  const preferences = Object.fromEntries(
    PREFERENCE_KEYS.map((key) => [key, typeof input.preferences?.[key] === "boolean" ? input.preferences[key] : key === "music"])
  ) as TripPreferences;
  const label = meetingPoint || cleanText(validPlace.label, { oneLine: true }).slice(0, LABEL_MAX);
  const point = { lat: validPlace.lat, lng: validPlace.lng, ...(label ? { label } : {}) };
  return {
    errors,
    payload: {
      direction,
      ...(direction === "TO_CAMPUS" ? { departure: point } : { destination: point }),
      departureAt: departureAt.toISOString(),
      seats,
      ...(price !== undefined ? { pricePerSeat: price } : {}),
      preferences,
      notes,
    },
  };
}

/** "Request a seat": 1..maxRequestSeats seats, optional message. */
export function validateSeatRequest(input: { seats: unknown; message: unknown }, maxSeats = DEFAULT_SETTINGS.maxRequestSeats) {
  const errors: ValidationErrors = {};
  const seats = Number(input?.seats);
  if (!Number.isInteger(seats) || seats < 1 || seats > maxSeats) errors.seats = { key: "seatsRange", values: { min: 1, max: maxSeats } };
  const message = cleanText(input?.message);
  if (message.length > REQUEST_MESSAGE_MAX) errors.message = { key: "messageTooLong", values: { max: REQUEST_MESSAGE_MAX } };
  return { errors, payload: hasErrors(errors) ? null : { seats, ...(message ? { message } : {}) } };
}

/** Chat message: 1–1000 characters once trimmed (line breaks kept). */
export function validateChatMessage(body: unknown): ValidationError | null {
  const text = cleanText(body);
  if (!text) return { key: "messageRequired" };
  if (text.length > MESSAGE_MAX) return { key: "messageTooLong", values: { max: MESSAGE_MAX } };
  return null;
}

/** Rating: integer 1–5 and an optional comment. */
export function validateRating(input: { score: unknown; comment: unknown }) {
  const errors: ValidationErrors = {};
  const score = Number(input?.score);
  if (!Number.isInteger(score) || score < 1 || score > 5) errors.score = { key: "scoreRequired" };
  const comment = cleanText(input?.comment);
  if (comment.length > RATING_COMMENT_MAX) errors.comment = { key: "commentTooLong", values: { max: RATING_COMMENT_MAX } };
  return { errors, payload: hasErrors(errors) ? null : { score, ...(comment ? { comment } : {}) } };
}

/** Optional free text of a decline (to the passenger) or a cancellation (reason). */
export function validateOptionalText(value: unknown, kind: "decline" | "cancel"): { error: ValidationError | null; text: string } {
  const text = cleanText(value);
  const max = kind === "decline" ? DECLINE_MESSAGE_MAX : CANCEL_REASON_MAX;
  return { error: text.length > max ? { key: kind === "decline" ? "messageTooLong" : "reasonTooLong", values: { max } } : null, text };
}
