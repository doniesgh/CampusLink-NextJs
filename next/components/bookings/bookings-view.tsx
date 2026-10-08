"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarSearch, DoorOpen, ListChecks, MousePointerClick } from "lucide-react";
import { useTranslations } from "next-intl";
import { AvailabilityPanel, type PickedSlot } from "@/components/bookings/availability-panel";
import { BookingForm, type BookingFormState } from "@/components/bookings/booking-form";
import { FreeRooms } from "@/components/bookings/free-rooms";
import { MyBookings, type InitialMine } from "@/components/bookings/my-bookings";
import { bookableResources, ResourcePicker } from "@/components/bookings/resource-picker";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { dateKey, isDateKey, type DateKey } from "@/lib/datetime";
import { invalidateQueries, useOfflineQuery, useOnlineStatus } from "@/lib/offline";
import { setSearch, useLocationSearch, useMediaQuery, useNow } from "@/lib/timetable/client";
import {
  availabilityRange,
  bookingsQuery,
  lastBookableDay,
  maxHoursFor,
  myBookingsQuery,
  parseBookingsParams,
  suggestSlot,
  type BookingsTab,
  type BookingsUrlState,
} from "@/lib/bookings/rules";
import {
  ACTIVE_STATUSES,
  type Availability,
  type BookableRoom,
  type BookingList,
  type Equipment,
  type PickableResource,
  type ResourceType,
} from "@/lib/bookings/types";
import type { Role } from "@/lib/types";

/** Below this width the availability opens on the day view (phones). */
const NARROW_QUERY = "(max-width: 639px)";

export type InitialAvailability = { id: string; data: Availability | null; savedAt: number };

type Navigate = (patch: Partial<BookingsUrlState>, options?: { replace?: boolean }) => void;

/** First form values: a prefill (free-room finder), else the day in the URL, else the next free quarter hour. */
function initialForm(now: number, urlDate: DateKey | null, prefill: PickedSlot | null): BookingFormState {
  if (prefill) return { ...prefill, purpose: "" };
  const slot = suggestSlot(now);
  const today = dateKey(now);
  if (urlDate && urlDate > slot.date && urlDate <= lastBookableDay(today)) return { date: urlDate, start: "08:00", end: "09:00", purpose: "" };
  return { ...slot, purpose: "" };
}

/** "Book" tab: resource picker -> availability (day / week) -> booking form. */
function BookTab({
  role,
  url,
  now,
  narrow,
  online,
  resources,
  initialAvailability,
  initialMine,
  prefill,
  navigate,
}: {
  role: Role;
  url: BookingsUrlState;
  now: number;
  narrow: boolean;
  online: boolean;
  resources: PickableResource[];
  initialAvailability: InitialAvailability | null;
  initialMine: InitialMine;
  prefill: PickedSlot | null;
  navigate: Navigate;
}) {
  const t = useTranslations("bookings");
  const today = dateKey(now);
  const type: ResourceType = url.type ?? (url.resource ? (resources.find((r) => r.id === url.resource)?.type ?? "ROOM") : "ROOM");
  const selected = url.resource ? (resources.find((resource) => resource.id === url.resource && resource.type === type) ?? null) : null;
  const view = url.view ?? (narrow ? "day" : "week");
  const viewDate = url.date ?? today;
  const range = selected ? availabilityRange(selected.type, selected.id, viewDate) : null;

  const [form, setForm] = useState<BookingFormState>(() => initialForm(now, url.date, prefill));
  const purposeRef = useRef<HTMLTextAreaElement | null>(null);
  const formRef = useRef<HTMLElement | null>(null);
  const availabilityRef = useRef<HTMLElement | null>(null);
  const scrollToAvailability = useRef(false);
  const selectedId = selected?.id ?? null;

  useEffect(() => {
    if (!selectedId || !scrollToAvailability.current) return;
    scrollToAvailability.current = false;
    availabilityRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [selectedId]);

  // The server rendered the availability of the week in the URL: seed that key once (no request on load).
  const [leftInitial, setLeftInitial] = useState(false);
  if (!leftInitial && range && initialAvailability && range.id !== initialAvailability.id) setLeftInitial(true);
  const seeded = !leftInitial && !!range && initialAvailability?.id === range.id && !!initialAvailability.data;
  const availability = useOfflineQuery<Availability>(range?.key ?? ["bookings", "availability", "none"], range?.path ?? null, {
    fallbackData: seeded ? (initialAvailability?.data ?? undefined) : undefined,
    fallbackSavedAt: seeded ? initialAvailability?.savedAt : undefined,
    revalidateOnMount: !seeded,
  });

  // Students: how many upcoming bookings they hold (limit 3), from the first page of "My bookings".
  const mineQuery = myBookingsQuery("upcoming", 1);
  const mine = useOfflineQuery<BookingList>(mineQuery.key, role === "STUDENT" ? mineQuery.path : null, {
    fallbackData: initialMine.data ?? undefined,
    fallbackSavedAt: initialMine.savedAt,
    revalidateOnMount: !initialMine.data,
    reportLastUpdated: false,
  });
  const upcomingCount =
    role === "STUDENT" && Array.isArray(mine.data?.items)
      ? mine.data.items.filter((booking) => ACTIVE_STATUSES.includes(booking.status) && Date.parse(booking.endsAt) > now).length
      : null;

  const busyForForm =
    availability.data && range && form.date >= range.from && form.date < range.to && Array.isArray(availability.data.busy)
      ? availability.data.busy
      : null;

  const changeForm = (patch: Partial<BookingFormState>) => {
    setForm((current) => ({ ...current, ...patch }));
    if (patch.date && isDateKey(patch.date) && patch.date !== viewDate) navigate({ date: patch.date }, { replace: true });
  };

  const pick = (slot: PickedSlot) => {
    setForm((current) => ({ ...current, ...slot }));
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      purposeRef.current?.focus({ preventScroll: true });
    });
  };

  return (
    <div className="space-y-8">
      <section aria-labelledby="book-resource" className="space-y-4">
        <h2 id="book-resource" className="text-lg font-semibold">
          {t("picker.title")}
        </h2>
        <ResourcePicker
          type={type}
          selectedId={selected?.id ?? null}
          resources={resources}
          onType={(value) => navigate({ type: value, resource: null }, { replace: true })}
          onSelect={(resource, { pointer }) => {
            // On phones the availability is below the list: show it after a tap (not while using arrow keys).
            scrollToAvailability.current = pointer && narrow;
            navigate({ type: resource.type, resource: resource.id }, { replace: true });
          }}
        />
      </section>

      {!selected ? (
        <EmptyState
          icon={url.resource ? DoorOpen : MousePointerClick}
          title={url.resource ? t("availability.unavailable") : t("availability.chooseFirst")}
          description={url.resource ? undefined : t("availability.chooseFirstHint")}
        />
      ) : (
        <>
          <section ref={availabilityRef} aria-labelledby="book-availability" className="scroll-mt-20 space-y-4">
            <h2 id="book-availability" className="text-lg font-semibold">
              {t("availability.title", { name: selected.name })}
            </h2>
            <AvailabilityPanel
              resourceName={selected.name}
              query={availability}
              view={view}
              date={viewDate}
              monday={range?.from ?? viewDate}
              today={today}
              now={now}
              isAdmin={role === "ADMIN"}
              maxHours={maxHoursFor(role)}
              selection={{ date: form.date, start: form.start, end: form.end }}
              online={online}
              onView={(value) => navigate({ view: value }, { replace: true })}
              onDate={(value) => navigate({ date: value })}
              onPick={pick}
            />
          </section>

          <section ref={formRef} aria-labelledby="book-form" className="scroll-mt-20 space-y-4 rounded-3xl border bg-card p-4 text-card-foreground sm:p-6">
            <h2 id="book-form" className="text-lg font-semibold">
              {selected.requiresApproval ? t("form.titleRequest") : t("form.title")}
            </h2>
            <BookingForm
              role={role}
              resource={selected}
              form={form}
              onChange={changeForm}
              busy={busyForForm}
              upcomingCount={upcomingCount}
              online={online}
              now={now}
              purposeRef={purposeRef}
              onBooked={(booking) => {
                setForm((current) => ({ ...current, purpose: "" }));
                // The new booking appears in the availability and in "My bookings".
                availability.mutate((current) =>
                  current
                    ? {
                        ...current,
                        busy: [
                          ...current.busy,
                          {
                            startsAt: booking.startsAt,
                            endsAt: booking.endsAt,
                            kind: "BOOKING" as const,
                            label: booking.purpose,
                            status: booking.status,
                            mine: true,
                            bookingId: booking.id,
                            purpose: booking.purpose,
                          },
                        ].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
                      }
                    : current
                );
                invalidateQueries("bookings");
              }}
              onSeeMine={() => navigate({ tab: "mine", scope: "upcoming" })}
            />
          </section>
        </>
      )}
    </div>
  );
}

/**
 * /dashboard/bookings (STUDENT, TEACHER, ADMIN): tabs "Book" (resource picker, availability calendar,
 * booking form), "Free rooms" (finder) and "My bookings" (upcoming / past, cancel, readable offline).
 * URL state `?tab=book|free|mine&type=ROOM|EQUIPMENT&resource=<id>&view=day|week&date=YYYY-MM-DD&scope=upcoming|past`
 * (+ `booking=<id>` from notifications), changed through the History API (no server round trip).
 */
export function BookingsView({
  role,
  serverSearch,
  serverNow,
  narrowGuess,
  rooms,
  equipment,
  initialMine,
  initialAvailability,
}: {
  role: Role;
  serverSearch: string;
  serverNow: number;
  narrowGuess: boolean;
  rooms: BookableRoom[];
  equipment: Equipment[];
  initialMine: InitialMine;
  initialAvailability: InitialAvailability | null;
}) {
  const t = useTranslations("bookings");
  const search = useLocationSearch(serverSearch);
  const url = useMemo(() => parseBookingsParams(new URLSearchParams(search)), [search]);
  const online = useOnlineStatus();
  const now = useNow(serverNow);
  const narrow = useMediaQuery(NARROW_QUERY, narrowGuess);
  const resources = useMemo(() => bookableResources(rooms, equipment), [rooms, equipment]);
  const [prefill, setPrefill] = useState<PickedSlot | null>(null);

  // Without ?tab: "My bookings" for a notification link or while offline (booking needs the network).
  const tab: BookingsTab = url.tab ?? (url.booking || !online ? "mine" : "book");

  const navigate: Navigate = (patch, options = {}) => setSearch(bookingsQuery({ ...url, ...patch }), options);

  return (
    <Tabs value={tab} onValueChange={(value) => navigate({ tab: value as BookingsTab, booking: value === "mine" ? url.booking : null }, { replace: true })}>
      {/* Phones: three equal tabs without icons, so the French labels fit without scrolling. */}
      <TabsList aria-label={t("tabs.label")} className="flex w-full sm:inline-flex sm:w-auto">
        <TabsTrigger value="book" className="flex-1 px-3 sm:flex-none sm:px-4">
          <CalendarSearch className="hidden h-4 w-4 sm:block" aria-hidden="true" />
          {t("tabs.book")}
        </TabsTrigger>
        <TabsTrigger value="free" className="flex-1 px-3 sm:flex-none sm:px-4">
          <DoorOpen className="hidden h-4 w-4 sm:block" aria-hidden="true" />
          {t("tabs.free")}
        </TabsTrigger>
        <TabsTrigger value="mine" className="flex-1 px-3 sm:flex-none sm:px-4">
          <ListChecks className="hidden h-4 w-4 sm:block" aria-hidden="true" />
          {t("tabs.mine")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="book">
        <BookTab
          role={role}
          url={url}
          now={now}
          narrow={narrow}
          online={online}
          resources={resources}
          initialAvailability={initialAvailability}
          initialMine={initialMine}
          prefill={prefill}
          navigate={navigate}
        />
      </TabsContent>
      <TabsContent value="free">
        <FreeRooms
          role={role}
          now={now}
          online={online}
          onBook={(room, slot) => {
            setPrefill(slot);
            navigate({ tab: "book", type: "ROOM", resource: room.id, date: slot.date, booking: null });
          }}
        />
      </TabsContent>
      <TabsContent value="mine">
        <MyBookings
          scope={url.scope ?? "upcoming"}
          now={now}
          online={online}
          initial={initialMine}
          highlight={url.booking}
          onScope={(scope) => navigate({ scope }, { replace: true })}
          onBook={() => navigate({ tab: "book", booking: null })}
        />
      </TabsContent>
    </Tabs>
  );
}

