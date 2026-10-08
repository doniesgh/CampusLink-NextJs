import { Camera, DoorOpen, FlaskConical, Laptop, Mic, Package, Projector, type LucideIcon } from "lucide-react";
import type { EquipmentCategory, ResourceType } from "@/lib/bookings/types";

const CATEGORY_ICONS: Record<EquipmentCategory, LucideIcon> = {
  PROJECTOR: Projector,
  LAPTOP: Laptop,
  CAMERA: Camera,
  AUDIO: Mic,
  LAB_KIT: FlaskConical,
  OTHER: Package,
};

/** Icon of a room (door) or of an equipment category (decorative: always next to the resource name). */
export function resourceIcon(type: ResourceType, category?: EquipmentCategory | null): LucideIcon {
  if (type === "ROOM") return DoorOpen;
  return (category && CATEGORY_ICONS[category]) || Package;
}
