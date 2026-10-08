"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CalendarX2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { AdminCancelButton, DecisionDialog } from "@/components/bookings/admin/decision-actions";
import { BookingStatusBadge } from "@/components/bookings/status-badge";
import { useBookingFormat } from "@/components/bookings/use-booking-format";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback, useFeedback } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ACTIVE_STATUSES,
  BOOKING_STATUSES,
  bookingResourceName,
  personName,
  type BookableRoom,
  type Booking,
  type BookingStatus,
  type Equipment,
} from "@/lib/bookings/types";

export type AllBookingsFilters = { status: BookingStatus | ""; resource: string; from: string; to: string };

/** Status / resource / from / to filters: each change replaces the URL and the server renders the list. */
function Filters({ filters, rooms, equipment }: { filters: AllBookingsFilters; rooms: BookableRoom[]; equipment: Equipment[] }) {
  const t = useTranslations("bookings.admin.all");
  const tStatuses = useTranslations("bookings.statuses");
  const tTypes = useTranslations("bookings.resourceTypes");
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const apply = (patch: Partial<AllBookingsFilters>) => {
    const next = { ...filters, ...patch };
    const params = new URLSearchParams({ tab: "all" });
    if (next.status) params.set("status", next.status);
    if (next.resource) params.set("resource", next.resource);
    // An empty "From" means no lower bound ("all"); without the parameter the page starts today.
    params.set("from", next.from || "all");
    if (next.to) params.set("to", next.to);
    startTransition(() => router.replace(`${pathname}?${params}`));
  };

  return (
    <form
      role="search"
      aria-label={t("filtersLabel")}
      aria-busy={pending || undefined}
      className="grid gap-3 rounded-3xl border bg-card p-4 text-card-foreground sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:items-end"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="space-y-1.5">
        <label htmlFor="all-status" className="block text-sm font-medium">
          {t("status")}
        </label>
        <Select id="all-status" value={filters.status} onChange={(event) => apply({ status: event.target.value as BookingStatus | "" })}>
          <option value="">{t("allStatuses")}</option>
          {BOOKING_STATUSES.map((status) => (
            <option key={status} value={status}>
              {tStatuses(status)}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="all-resource" className="block text-sm font-medium">
          {t("resource")}
        </label>
        <Select id="all-resource" value={filters.resource} onChange={(event) => apply({ resource: event.target.value })}>
          <option value="">{t("allResources")}</option>
          <optgroup label={tTypes("ROOM")}>
            {rooms.map((room) => (
              <option key={room.id} value={`ROOM:${room.id}`}>
                {room.name}
              </option>
            ))}
          </optgroup>
          <optgroup label={tTypes("EQUIPMENT")}>
            {equipment.map((item) => (
              <option key={item.id} value={`EQUIPMENT:${item.id}`}>
                {item.name}
              </option>
            ))}
          </optgroup>
        </Select>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="all-from" className="block text-sm font-medium">
          {t("from")}
        </label>
        <Input id="all-from" type="date" value={filters.from} onChange={(event) => apply({ from: event.target.value })} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="all-to" className="block text-sm font-medium">
          {t("to")}
        </label>
        <Input id="all-to" type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => apply({ to: event.target.value })} />
      </div>
      <Button type="button" variant="outline" className="rounded-full" onClick={() => startTransition(() => router.replace(`${pathname}?tab=all`))}>
        {t("reset")}
      </Button>
    </form>
  );
}

/** "All bookings": filters and a table (when, resource, requester, purpose, status, actions). */
export function AllBookings({
  bookings,
  total,
  filters,
  rooms,
  equipment,
  now,
}: {
  bookings: Booking[];
  total: number;
  filters: AllBookingsFilters;
  rooms: BookableRoom[];
  equipment: Equipment[];
  now: number;
}) {
  const t = useTranslations("bookings.admin.all");
  const tTypes = useTranslations("bookings.resourceType");
  const tRoles = useTranslations("common.roles");
  const fmt = useBookingFormat();
  const [feedback, setFeedback] = useFeedback();

  return (
    <section aria-labelledby="all-title" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="all-title" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("count", { count: total })}</p>
      </div>
      <Filters filters={filters} rooms={rooms} equipment={equipment} />
      <InlineFeedback feedback={feedback} />

      {bookings.length === 0 ? (
        <EmptyState icon={CalendarX2} headingLevel="h3" title={t("empty")} description={t("emptyHint")} />
      ) : (
        <Table aria-label={t("title")}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("when")}</TableHead>
              <TableHead>{t("resource")}</TableHead>
              <TableHead>{t("requester")}</TableHead>
              <TableHead>{t("purpose")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead className="text-right">{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bookings.map((booking) => {
              const ended = Date.parse(booking.endsAt) <= now;
              const cancellable = ACTIVE_STATUSES.includes(booking.status) && !ended;
              return (
                <TableRow key={booking.id} data-booking-id={booking.id} data-status={booking.status}>
                  <TableCell className="whitespace-nowrap">
                    <time dateTime={booking.startsAt}>{fmt.when(booking.startsAt, booking.endsAt)}</time>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{bookingResourceName(booking)}</span>
                    <span className="block text-xs text-muted-foreground">{tTypes(booking.resourceType)}</span>
                  </TableCell>
                  <TableCell>
                    {personName(booking.user)}
                    {booking.user?.role && <span className="block text-xs text-muted-foreground">{tRoles(booking.user.role)}</span>}
                  </TableCell>
                  <TableCell className="min-w-48 max-w-xs">
                    <span className="line-clamp-2 break-words" title={booking.purpose}>
                      {booking.purpose}
                    </span>
                  </TableCell>
                  <TableCell>
                    <BookingStatusBadge status={booking.status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      {booking.status === "PENDING" && <DecisionDialog booking={booking} mode="reject" onDone={setFeedback} />}
                      {booking.status === "PENDING" && !ended && <DecisionDialog booking={booking} mode="approve" onDone={setFeedback} />}
                      {cancellable && booking.status === "CONFIRMED" && <AdminCancelButton booking={booking} onDone={setFeedback} />}
                      {!cancellable && booking.status !== "PENDING" && (
                        <span className="text-muted-foreground">
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">{t("noAction")}</span>
                        </span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
