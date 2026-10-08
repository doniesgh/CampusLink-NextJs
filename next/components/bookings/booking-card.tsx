"use client";

import { forwardRef } from "react";
import { MessageSquareText, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { resourceIcon } from "@/components/bookings/resource-icon";
import { BookingStatusBadge } from "@/components/bookings/status-badge";
import { useBookingFormat } from "@/components/bookings/use-booking-format";
import { bookingResourceName, personName, type Booking } from "@/lib/bookings/types";
import { cn } from "@/lib/utils";

/**
 * One booking: resource, status, day and times, purpose, the admin's decision note and (for admins) the
 * requester. `article[data-booking-id][data-status]`; `highlighted` draws a ring (notification links).
 */
export const BookingCard = forwardRef<
  HTMLElement,
  {
    booking: Booking;
    /** Show who asked (admin views). */
    showRequester?: boolean;
    highlighted?: boolean;
    headingLevel?: "h3" | "h4";
    /** Extra badges next to the status (e.g. "Ended"). */
    badges?: React.ReactNode;
    actions?: React.ReactNode;
    className?: string;
  }
>(function BookingCard({ booking, showRequester = false, highlighted = false, headingLevel = "h3", badges, actions, className }, ref) {
  const t = useTranslations("bookings.card");
  const tTypes = useTranslations("bookings.resourceType");
  const tRoles = useTranslations("common.roles");
  const fmt = useBookingFormat();
  const Heading = headingLevel;
  const Icon = resourceIcon(booking.resourceType, booking.equipment?.category);
  const decisionBy = personName(booking.decision?.by);
  const note = booking.decision?.note?.trim();
  const place = booking.room ? [booking.room.building, booking.room.capacity ? t("seats", { count: booking.room.capacity }) : ""].filter(Boolean).join(" · ") : "";

  return (
    <article
      ref={ref}
      data-booking-id={booking.id}
      data-status={booking.status}
      tabIndex={highlighted ? -1 : undefined}
      className={cn(
        "flex flex-col gap-3 rounded-3xl border bg-card p-4 text-card-foreground sm:p-5",
        highlighted && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        (booking.status === "CANCELLED" || booking.status === "REJECTED") && "bg-muted/40",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Heading className="min-w-0 break-words text-base font-semibold leading-tight">{bookingResourceName(booking)}</Heading>
            <BookingStatusBadge status={booking.status} />
            {badges}
          </div>
          <p className="text-sm font-medium text-foreground">
            <time dateTime={booking.startsAt}>{fmt.when(booking.startsAt, booking.endsAt)}</time>
          </p>
          <p className="text-xs text-muted-foreground">
            {tTypes(booking.resourceType)}
            {place ? ` · ${place}` : ""}
          </p>
        </div>
      </div>

      <p className="whitespace-pre-line break-words text-sm text-foreground">
        <span className="sr-only">{t("purpose")} </span>
        {booking.purpose}
      </p>

      {showRequester && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <UserRound className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {t("requestedBy", { name: personName(booking.user) || t("unknownUser") })}
            {booking.user?.role ? ` · ${tRoles(booking.user.role)}` : ""}
          </span>
        </p>
      )}

      {booking.status === "PENDING" && !showRequester && <p className="text-sm text-muted-foreground">{t("waiting")}</p>}
      {booking.status === "CANCELLED" && booking.cancelledBy === "ADMIN" && (
        <p className="text-sm text-muted-foreground">{t("cancelledByAdmin")}</p>
      )}
      {note && (booking.status === "REJECTED" || booking.status === "CONFIRMED" || booking.status === "CANCELLED") && (
        <p className="flex items-start gap-2 rounded-2xl bg-muted px-3 py-2 text-sm text-foreground">
          <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="whitespace-pre-line break-words">
            {booking.status === "REJECTED"
              ? t("rejectedReason", { note })
              : decisionBy
                ? t("noteFrom", { name: decisionBy, note })
                : t("note", { note })}
          </span>
        </p>
      )}

      {actions && <div className="flex flex-wrap justify-end gap-2">{actions}</div>}
    </article>
  );
});
