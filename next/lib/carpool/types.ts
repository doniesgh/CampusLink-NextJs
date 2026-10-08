// Shapes of the carpooling API (Module 2, backend/docs/carpool.md). Types and small runtime guards only:
// usable from Server and Client Components.

export const DIRECTIONS = ["TO_CAMPUS", "FROM_CAMPUS"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const TRIP_STATUSES = ["OPEN", "FULL", "CANCELLED", "COMPLETED"] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export const REQUEST_STATUSES = ["PENDING", "ACCEPTED", "DECLINED", "CANCELLED", "EXPIRED"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export type TripRole = "DRIVER" | "PASSENGER";

/** A point of the trip. Coordinates are exact only for the driver and the accepted passengers (`exactLocation`). */
export type TripPlace = { label: string; lat: number; lng: number };

/** A curated place of the picker (GET /api/carpool/places). */
export type Place = { id: string; label: string; lat: number; lng: number };

export type TripPreferences = { smoking: boolean; music: boolean; pets: boolean; womenOnly: boolean };
export const PREFERENCE_KEYS = ["music", "smoking", "pets", "womenOnly"] as const;
export type PreferenceKey = (typeof PREFERENCE_KEYS)[number];

export type PersonRating = { rating: number | null; ratingCount: number };

export type TripDriver = { id: string; firstname: string; lastname: string } & PersonRating;

export type MyRequest = { id: string; status: RequestStatus; seats: number };

export type Trip = {
  id: string;
  driver: TripDriver;
  direction: Direction;
  departure: TripPlace;
  destination: TripPlace;
  exactLocation: boolean;
  departureAt: string;
  seats: number;
  seatsLeft: number;
  pricePerSeat: number;
  distanceKm: number;
  preferences: TripPreferences;
  notes: string;
  status: TripStatus;
  cancelledAt: string | null;
  cancelledBy: "DRIVER" | "ADMIN" | null;
  cancelReason: string | null;
  myRole: TripRole | null;
  myRequest: MyRequest | null;
  createdAt: string;
  updatedAt: string;
  /** Only in a search with a location (km, 1 decimal). */
  distanceFromYouKm?: number | null;
};

export type Participant = {
  id: string;
  firstname: string;
  lastname: string;
  role: TripRole;
  seats: number | null;
  me: boolean;
  myRating: { score: number; comment: string; createdAt: string } | null;
} & PersonRating;

export type TripRequest = {
  id: string;
  tripId: string;
  passenger: { id: string; firstname: string; lastname: string } & PersonRating;
  seats: number;
  message: string;
  responseMessage: string;
  status: RequestStatus;
  createdAt: string;
  decidedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: "PASSENGER" | "TRIP" | null;
};

/** GET /trips/:id and the answers of the trip actions. */
export type TripDetail = Trip & {
  /** Driver and accepted passengers, for them only (null otherwise). */
  participants: Participant[] | null;
  canRate: boolean;
  /** Every request of the trip, for the driver only (null otherwise). */
  requests: TripRequest[] | null;
};

export type TripList = { items: Trip[]; total: number; page: number; limit: number };

export type TripMessage = {
  id: string;
  tripId: string;
  sender: { id: string; firstname: string; lastname: string };
  body: string;
  clientRequestId: string | null;
  createdAt: string;
};

export type MessagePage = { items: TripMessage[]; hasMore: boolean };

export type TripRating = {
  id: string;
  tripId: string;
  raterId: string;
  rateeId: string;
  score: number;
  comment: string;
  createdAt: string;
};

/** GET /api/carpool/settings. */
export type CarpoolSettings = {
  campus: { label: string; lat: number; lng: number };
  costPerKm: number;
  roadFactor: number;
  defaultRadiusKm: number;
  maxRadiusKm: number;
  minSeats: number;
  maxSeats: number;
  maxRequestSeats: number;
  maxPricePerSeat: number;
  maxDaysAhead: number;
  maxUpcomingTrips: number;
};

/** Same defaults as the backend (used when /settings can't be read). */
export const DEFAULT_SETTINGS: CarpoolSettings = {
  campus: { label: "ESPRIT Ghazela", lat: 36.8992, lng: 10.1897 },
  costPerKm: 0.25,
  roadFactor: 1.3,
  defaultRadiusKm: 5,
  maxRadiusKm: 20,
  minSeats: 1,
  maxSeats: 6,
  maxRequestSeats: 3,
  maxPricePerSeat: 20,
  maxDaysAhead: 30,
  maxUpcomingTrips: 5,
};

// Limits of the API (backend models).
export const NOTES_MAX = 500;
export const LABEL_MAX = 120;
export const REQUEST_MESSAGE_MAX = 300;
export const DECLINE_MESSAGE_MAX = 300;
export const CANCEL_REASON_MAX = 300;
export const MESSAGE_MAX = 1000;
export const RATING_COMMENT_MAX = 300;
/** Messages can still be sent until 7 days after the departure. */
export const CHAT_OPEN_AFTER_DEPARTURE_MS = 7 * 24 * 60 * 60 * 1000;
/** A trip is "past" (history, ratings) one hour after its departure. */
export const TRIP_DURATION_MS = 60 * 60 * 1000;

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
export const isObjectId = (value: unknown): value is string => typeof value === "string" && OBJECT_ID_RE.test(value);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export function isTrip(value: unknown): value is Trip {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isRecord(value.driver) &&
    isRecord(value.departure) &&
    isRecord(value.destination) &&
    typeof value.departureAt === "string" &&
    typeof value.status === "string"
  );
}

export function isTripDetail(value: unknown): value is TripDetail {
  return isTrip(value) && "canRate" in value;
}

export function isTripList(value: unknown): value is TripList {
  return isRecord(value) && Array.isArray(value.items) && typeof value.total === "number";
}

export function isMessagePage(value: unknown): value is MessagePage {
  return isRecord(value) && Array.isArray(value.items);
}

export function isTripMessage(value: unknown): value is TripMessage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.tripId === "string" &&
    typeof value.body === "string" &&
    typeof value.createdAt === "string" &&
    isRecord(value.sender)
  );
}

export function isPlaceList(value: unknown): value is Place[] {
  return (
    Array.isArray(value) &&
    value.every((place) => isRecord(place) && typeof place.id === "string" && typeof place.lat === "number" && typeof place.lng === "number")
  );
}

export function isSettings(value: unknown): value is CarpoolSettings {
  return isRecord(value) && isRecord(value.campus) && typeof value.costPerKm === "number";
}

/** The off-campus end of the trip (where passengers are picked up or dropped). */
export const offCampusPlace = (trip: Pick<Trip, "direction" | "departure" | "destination">): TripPlace =>
  trip.direction === "FROM_CAMPUS" ? trip.destination : trip.departure;

/** Driver or accepted passenger: sees exact places, the chat and the participants. */
export const isParticipant = (trip: Pick<Trip, "myRole">): boolean => trip.myRole === "DRIVER" || trip.myRole === "PASSENGER";
