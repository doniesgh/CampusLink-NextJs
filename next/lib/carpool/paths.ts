// Web pages, API paths (relative to /api, for serverApi and the BFF), offline query keys and the URL state of
// /dashboard/carpool. Isomorphic (no browser or server-only API).
import { addDays, isDateKey, type DateKey } from "@/lib/datetime";
import type { LatLng } from "@/lib/carpool/geo";
import { DIRECTIONS, isObjectId, type Direction, type Place } from "@/lib/carpool/types";

export const carpoolHref = "/dashboard/carpool";
export const tripHref = (id: string) => `/dashboard/carpool/${id}`;

export const placesPath = "/carpool/places";
export const settingsPath = "/carpool/settings";
export const tripPath = (id: string) => `/carpool/trips/${id}`;
export const messagesPath = (id: string, before?: string | null, limit = MESSAGES_PAGE) =>
  `/carpool/trips/${id}/messages?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ""}`;

export const PAGE_SIZE = 20;
export const MESSAGES_PAGE = 50;
/** Radius choices of the search (km); the API accepts up to 20. */
export const RADIUS_OPTIONS = [2, 5, 10, 15, 20] as const;
/** Seats a passenger may ask for at once (the API: 1–3). */
export const REQUEST_SEAT_OPTIONS = [1, 2, 3] as const;

export const TABS = ["search", "offer", "mine"] as const;
export type CarpoolTab = (typeof TABS)[number];
export type MineRole = "driver" | "passenger";
export type MineScope = "upcoming" | "past";

/** URL state of /dashboard/carpool (`?tab&place&radius&date&direction&seats&page&role&scope`). */
export type CarpoolUrlState = {
  tab: CarpoolTab;
  /** Curated place id of the search ("Use my location" is never put in the address). */
  place: string | null;
  radius: number;
  date: DateKey | null;
  direction: Direction | null;
  seats: number;
  page: number;
  role: MineRole;
  scope: MineScope;
};

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function read(params: Params, name: string): string | null {
  if (params instanceof URLSearchParams) return params.get(name);
  const value = params[name];
  return typeof value === "string" ? value : Array.isArray(value) ? (value[0] ?? null) : null;
}

const PLACE_ID_RE = /^[a-z0-9-]{1,40}$/;

export function parseCarpoolParams(params: Params, defaultRadius = 5): CarpoolUrlState {
  const tab = read(params, "tab");
  const place = read(params, "place");
  const radius = Number(read(params, "radius"));
  const date = read(params, "date");
  const direction = read(params, "direction");
  const seats = Number(read(params, "seats"));
  const page = Number(read(params, "page"));
  const role = read(params, "role");
  const scope = read(params, "scope");
  return {
    tab: (TABS as readonly string[]).includes(tab ?? "") ? (tab as CarpoolTab) : "search",
    place: place && PLACE_ID_RE.test(place) ? place : null,
    radius: (RADIUS_OPTIONS as readonly number[]).includes(radius) ? radius : defaultRadius,
    date: isDateKey(date) ? date : null,
    direction: (DIRECTIONS as readonly string[]).includes(direction ?? "") ? (direction as Direction) : null,
    seats: (REQUEST_SEAT_OPTIONS as readonly number[]).includes(seats) ? seats : 1,
    page: Number.isInteger(page) && page > 1 && page < 1000 ? page : 1,
    role: role === "passenger" ? "passenger" : "driver",
    scope: scope === "past" ? "past" : "upcoming",
  };
}

/** Query string of a state, without the default values (so the plain address stays "/dashboard/carpool"). */
export function carpoolQuery(state: CarpoolUrlState, defaultRadius = 5): string {
  const query = new URLSearchParams();
  if (state.tab !== "search") query.set("tab", state.tab);
  if (state.tab === "search") {
    if (state.place) query.set("place", state.place);
    if (state.radius !== defaultRadius) query.set("radius", String(state.radius));
    if (state.date) query.set("date", state.date);
    if (state.direction) query.set("direction", state.direction);
    if (state.seats !== 1) query.set("seats", String(state.seats));
  }
  if (state.tab === "mine") {
    if (state.role !== "driver") query.set("role", state.role);
    if (state.scope !== "upcoming") query.set("scope", state.scope);
  }
  if (state.tab !== "offer" && state.page > 1) query.set("page", String(state.page));
  return query.toString();
}

/** Where the search is centred: a curated place or the device's position (state only). */
export type SearchPoint = { kind: "place"; place: Place } | { kind: "geo"; point: LatLng; accuracy: number | null };

export type SearchInput = {
  point: SearchPoint | null;
  radius: number;
  date: DateKey | null;
  direction: Direction | null;
  seats: number;
  page: number;
};

/** GET /api/carpool/trips with the filters, and its offline query key. */
export function searchQuery(input: SearchInput): { key: (string | number)[]; path: string } {
  const query = new URLSearchParams();
  let pointKey = "all";
  if (input.point) {
    const point = input.point.kind === "place" ? input.point.place : input.point.point;
    query.set("lat", String(point.lat));
    query.set("lng", String(point.lng));
    query.set("radiusKm", String(input.radius));
    pointKey = input.point.kind === "place" ? `place-${input.point.place.id}` : `geo-${point.lat},${point.lng}`;
  }
  if (input.date) {
    query.set("from", input.date);
    query.set("to", addDays(input.date, 1));
  }
  if (input.direction) query.set("direction", input.direction);
  if (input.seats > 1) query.set("seats", String(input.seats));
  query.set("page", String(input.page));
  query.set("limit", String(PAGE_SIZE));
  return {
    key: ["carpool", "search", pointKey, input.point ? input.radius : 0, input.date ?? "", input.direction ?? "", input.seats, input.page],
    path: `/carpool/trips?${query.toString()}`,
  };
}

/** GET /api/carpool/me/trips and its offline query key. */
export function myTripsQuery(role: MineRole, scope: MineScope, page: number, limit = PAGE_SIZE): { key: (string | number)[]; path: string } {
  return {
    key: ["carpool", "mine", role, scope, page, limit],
    path: `/carpool/me/trips?role=${role}&scope=${scope}&page=${page}&limit=${limit}`,
  };
}

export const tripKey = (id: string) => ["carpool", "trip", id];
export const placesKey = ["carpool", "places"];

export const isTripId = isObjectId;
