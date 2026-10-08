// Shapes of the bookings module (/api/resources, /api/bookings), see docs/phase2-contract.md section 1 and
// backend/docs/bookings.md. Types only, plus a few constants (isomorphic).
import type { Paginated, Role, Room, RoomType } from "@/lib/types";

export type ResourceType = "ROOM" | "EQUIPMENT";
export const RESOURCE_TYPES: readonly ResourceType[] = ["ROOM", "EQUIPMENT"];

export type BookingStatus = "PENDING" | "CONFIRMED" | "REJECTED" | "CANCELLED";
export const BOOKING_STATUSES: readonly BookingStatus[] = ["PENDING", "CONFIRMED", "REJECTED", "CANCELLED"];
/** Statuses that hold the resource (and count toward the student limit). */
export const ACTIVE_STATUSES: readonly BookingStatus[] = ["PENDING", "CONFIRMED"];

export type EquipmentCategory = "PROJECTOR" | "LAPTOP" | "CAMERA" | "AUDIO" | "LAB_KIT" | "OTHER";
export const EQUIPMENT_CATEGORIES: readonly EquipmentCategory[] = ["PROJECTOR", "LAPTOP", "CAMERA", "AUDIO", "LAB_KIT", "OTHER"];

/**
 * Room as returned by GET /api/academic/rooms since phase 2: the two booking fields are added by the bookings
 * module (rooms stored before phase 2 read as the defaults: bookable, approval for amphitheaters only).
 */
export type BookableRoom = Room & { bookable?: boolean; requiresApproval?: boolean };

export type Equipment = {
  id: string;
  name: string;
  category: EquipmentCategory;
  location: string;
  description: string;
  requiresApproval: boolean;
  active: boolean;
};

export type BookingRoomRef = { id: string; name: string; building: string; capacity: number | null; type: RoomType | null };
export type BookingEquipmentRef = { id: string; name: string; category: EquipmentCategory | null };
export type BookingUser = { id: string; firstname: string; lastname: string; role: Role };

export type Booking = {
  id: string;
  resourceType: ResourceType;
  room: BookingRoomRef | null;
  equipment: BookingEquipmentRef | null;
  user: BookingUser;
  purpose: string;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  decision: { by: { id: string; firstname: string; lastname: string } | null; at: string; note: string } | null;
  cancelledAt?: string | null;
  cancelledBy?: "OWNER" | "ADMIN" | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type BookingList = Paginated<Booking>;

/** One busy interval of GET /api/bookings/availability. */
export type BusySlot = {
  startsAt: string;
  endsAt: string;
  kind: "BOOKING" | "CLASS";
  /** "Booked" / "Class" (fixed English words) for non-admins, the purpose of one's own booking, details for admins. */
  label: string;
  status?: BookingStatus;
  mine?: boolean;
  bookingId?: string;
  purpose?: string;
  user?: { id: string; firstname: string; lastname: string; role?: Role } | null;
  sessionId?: string;
  subject?: { id: string; name: string; code: string } | null;
};

export type Availability = {
  resourceType: ResourceType;
  resource: string;
  bookable: boolean;
  requiresApproval: boolean;
  from: string;
  to: string;
  busy: BusySlot[];
};

/** Entry of `details.conflicts` of 409 BOOKING_CONFLICT. */
export type BookingConflict = {
  kind: "BOOKING" | "CLASS";
  startsAt: string;
  endsAt: string;
  mine?: boolean;
  status?: BookingStatus;
  purpose?: string;
  user?: { firstname: string; lastname: string } | null;
  subject?: { name: string; code: string } | null;
};

export type ResourceUsage = {
  resourceType: ResourceType;
  id: string;
  name: string;
  bookings: number;
  bookedHours: number;
  /** 0..1 */
  occupancyRate: number;
};

export type BookingStats = {
  from: string;
  to: string;
  totals: { byStatus: Record<BookingStatus, number>; bookings: number; bookedHours: number; openingHours: number };
  resources: ResourceUsage[];
};

/** A resource the picker can offer (room or equipment item), with what the UI shows. */
export type PickableResource = {
  type: ResourceType;
  id: string;
  name: string;
  requiresApproval: boolean;
  room?: BookableRoom;
  equipment?: Equipment;
};

export function roomRequiresApproval(room: BookableRoom): boolean {
  return room.requiresApproval ?? room.type === "AMPHITHEATER";
}

export function isRoomBookable(room: BookableRoom): boolean {
  return room.bookable !== false;
}

/** Name of the booked resource (room or equipment). */
export function bookingResourceName(booking: Pick<Booking, "room" | "equipment">): string {
  return booking.room?.name ?? booking.equipment?.name ?? "—";
}

export function personName(user: { firstname?: string; lastname?: string } | null | undefined): string {
  return user ? `${user.firstname ?? ""} ${user.lastname ?? ""}`.trim() : "";
}
