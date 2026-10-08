// Distances and the suggested shared cost, computed exactly like the backend (service/carpoolService.js), so
// the "Offer a trip" form shows the price the API would choose when none is sent.
import type { CarpoolSettings } from "@/lib/carpool/types";

export type LatLng = { lat: number; lng: number };

const round = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371.0088;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Estimated road distance: haversine × roadFactor (1.3), 1 decimal. */
export function roadDistanceKm(a: LatLng, b: LatLng, settings: Pick<CarpoolSettings, "roadFactor">): number {
  return round(haversineKm(a, b) * settings.roadFactor, 1);
}

/** Suggested price per seat: distanceKm × costPerKm / (seats + 1), 1 decimal, capped at the maximum price. */
export function suggestedPrice(distanceKm: number, seats: number, settings: Pick<CarpoolSettings, "costPerKm" | "maxPricePerSeat">): number {
  if (!Number.isFinite(distanceKm) || !Number.isFinite(seats) || seats < 1) return 0;
  return Math.min(settings.maxPricePerSeat, round((distanceKm * settings.costPerKm) / (seats + 1), 1));
}

/** Coordinates kept for a search: 3 decimals (~100 m) are plenty, and less precise than the device's fix. */
export function coarse(point: LatLng): LatLng {
  return { lat: round(point.lat, 3), lng: round(point.lng, 3) };
}

/** OpenStreetMap link centred on a point (participants only: they get the exact coordinates). */
export function mapLink(point: LatLng): string {
  const lat = point.lat.toFixed(5);
  const lng = point.lng.toFixed(5);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
}
