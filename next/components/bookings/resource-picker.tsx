"use client";

import { useId, useMemo, useRef, useState } from "react";
import { MapPin, Search, ShieldCheck, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { resourceIcon } from "@/components/bookings/resource-icon";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ROOM_TYPES, type RoomType } from "@/lib/types";
import {
  EQUIPMENT_CATEGORIES,
  isRoomBookable,
  roomRequiresApproval,
  type BookableRoom,
  type Equipment,
  type EquipmentCategory,
  type PickableResource,
  type ResourceType,
} from "@/lib/bookings/types";
import { cn } from "@/lib/utils";

/** Case- and accent-insensitive "contains". */
function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function toPickable(type: ResourceType, item: BookableRoom | Equipment): PickableResource {
  if (type === "ROOM") {
    const room = item as BookableRoom;
    return { type, id: room.id, name: room.name, requiresApproval: roomRequiresApproval(room), room };
  }
  const equipment = item as Equipment;
  return { type, id: equipment.id, name: equipment.name, requiresApproval: equipment.requiresApproval, equipment };
}

/** Bookable rooms and active equipment (the lists the picker offers). */
export function bookableResources(rooms: readonly BookableRoom[], equipment: readonly Equipment[]): PickableResource[] {
  return [
    ...rooms.filter(isRoomBookable).map((room) => toPickable("ROOM", room)),
    ...equipment.filter((item) => item.active !== false).map((item) => toPickable("EQUIPMENT", item)),
  ];
}

/**
 * "Choose a resource": Rooms / Equipment, filters (search, room type, minimum capacity, building, category)
 * and the resources as radio cards (arrow keys move between them).
 */
export function ResourcePicker({
  type,
  selectedId,
  resources,
  onType,
  onSelect,
}: {
  type: ResourceType;
  selectedId: string | null;
  resources: readonly PickableResource[];
  onType: (type: ResourceType) => void;
  /** `pointer`: chosen with a mouse or a finger (not the keyboard). */
  onSelect: (resource: PickableResource, options: { pointer: boolean }) => void;
}) {
  const t = useTranslations("bookings.picker");
  const tTypes = useTranslations("bookings.resourceTypes");
  const tRoomTypes = useTranslations("bookings.roomTypes");
  const tCategories = useTranslations("bookings.categories");
  const baseId = useId();
  const pointerDown = useRef(false);
  const [q, setQ] = useState("");
  const [roomType, setRoomType] = useState<RoomType | "">("");
  const [minCapacity, setMinCapacity] = useState("");
  const [building, setBuilding] = useState("");
  const [category, setCategory] = useState<EquipmentCategory | "">("");

  const ofType = useMemo(() => resources.filter((resource) => resource.type === type), [resources, type]);
  const buildings = useMemo(
    () => [...new Set(ofType.map((resource) => resource.room?.building?.trim()).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b)),
    [ofType]
  );

  const filtered = useMemo(() => {
    const needle = normalize(q.trim());
    const capacity = Number.parseInt(minCapacity, 10);
    return ofType.filter((resource) => {
      if (needle) {
        const haystack = normalize(
          [resource.name, resource.room?.building, resource.equipment?.location, resource.equipment?.description].filter(Boolean).join(" ")
        );
        if (!haystack.includes(needle)) return false;
      }
      if (resource.room) {
        if (roomType && resource.room.type !== roomType) return false;
        if (Number.isFinite(capacity) && capacity > 0 && (resource.room.capacity ?? 0) < capacity) return false;
        if (building && resource.room.building !== building) return false;
      }
      if (resource.equipment && category && resource.equipment.category !== category) return false;
      return true;
    });
  }, [ofType, q, roomType, minCapacity, building, category]);

  const field = (suffix: string) => `${baseId}-${suffix}`;

  return (
    <div className="space-y-4">
      <div role="group" aria-label={tTypes("label")} className="inline-flex rounded-full bg-muted p-1">
        {(["ROOM", "EQUIPMENT"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={value === type}
            onClick={() => onType(value)}
            className={cn(
              "min-h-9 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              value === type ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tTypes(value)}
          </button>
        ))}
      </div>

      <div className={cn("grid gap-3 sm:grid-cols-2", type === "ROOM" ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
          <label htmlFor={field("q")} className="block text-sm font-medium">
            {t("search")}
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id={field("q")}
              type="search"
              value={q}
              placeholder={type === "ROOM" ? t("searchRoomsPlaceholder") : t("searchEquipmentPlaceholder")}
              className="pl-10"
              onChange={(event) => setQ(event.target.value)}
            />
          </div>
        </div>
        {type === "ROOM" ? (
          <>
            <div className="space-y-1.5">
              <label htmlFor={field("type")} className="block text-sm font-medium">
                {t("roomType")}
              </label>
              <Select id={field("type")} value={roomType} onChange={(event) => setRoomType(event.target.value as RoomType | "")}>
                <option value="">{t("allRoomTypes")}</option>
                {ROOM_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {tRoomTypes(value)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={field("capacity")} className="block text-sm font-medium">
                {t("minCapacity")}
              </label>
              <Input
                id={field("capacity")}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={minCapacity}
                onChange={(event) => setMinCapacity(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={field("building")} className="block text-sm font-medium">
                {t("building")}
              </label>
              <Select id={field("building")} value={building} onChange={(event) => setBuilding(event.target.value)}>
                <option value="">{t("allBuildings")}</option>
                {buildings.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </div>
          </>
        ) : (
          <div className="space-y-1.5">
            <label htmlFor={field("category")} className="block text-sm font-medium">
              {t("category")}
            </label>
            <Select id={field("category")} value={category} onChange={(event) => setCategory(event.target.value as EquipmentCategory | "")}>
              <option value="">{t("allCategories")}</option>
              {EQUIPMENT_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {tCategories(value)}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {t("count", { count: filtered.length })}
      </p>

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {ofType.length === 0 ? (type === "ROOM" ? t("noRoomsAtAll") : t("noEquipmentAtAll")) : type === "ROOM" ? t("noRooms") : t("noEquipment")}
        </p>
      ) : (
        <fieldset>
          <legend className="sr-only">{type === "ROOM" ? t("legendRooms") : t("legendEquipment")}</legend>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((resource) => {
              const id = field(`r-${resource.id}`);
              const Icon = resourceIcon(resource.type, resource.equipment?.category);
              const checked = resource.id === selectedId;
              const details =
                resource.type === "ROOM"
                  ? [resource.room?.type ? tRoomTypes(resource.room.type) : "", resource.room?.building ?? ""].filter(Boolean).join(" · ")
                  : tCategories(resource.equipment?.category ?? "OTHER");
              return (
                <li key={resource.id} data-resource-id={resource.id}>
                  <label
                    htmlFor={id}
                    onPointerDown={() => {
                      pointerDown.current = true;
                    }}
                    className={cn(
                      "relative flex h-full cursor-pointer items-start gap-3 rounded-2xl border bg-card p-3 text-card-foreground transition-colors hover:bg-accent/60",
                      "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
                      checked && "border-primary bg-accent"
                    )}
                  >
                    <input
                      id={id}
                      type="radio"
                      name={field("resource")}
                      value={resource.id}
                      checked={checked}
                      onChange={() => {
                        onSelect(resource, { pointer: pointerDown.current });
                        pointerDown.current = false;
                      }}
                      onKeyDown={() => {
                        pointerDown.current = false;
                      }}
                      aria-label={resource.name}
                      aria-describedby={`${id}-details`}
                      className="absolute inset-0 z-10 h-full w-full cursor-pointer appearance-none rounded-2xl opacity-0"
                    />
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                        checked ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="block break-words text-sm font-semibold leading-tight">{resource.name}</span>
                      <span id={`${id}-details`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span>{details}</span>
                        {resource.room?.capacity ? (
                          <span className="inline-flex items-center gap-1">
                            <Users className="h-3 w-3" aria-hidden="true" />
                            {t("capacity", { count: resource.room.capacity })}
                          </span>
                        ) : null}
                        {resource.equipment?.location ? (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" aria-hidden="true" />
                            {resource.equipment.location}
                          </span>
                        ) : null}
                        {resource.requiresApproval && (
                          <Badge variant="warning" className="px-2 py-0 text-[11px]">
                            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                            {t("needsApproval")}
                          </Badge>
                        )}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}
    </div>
  );
}
