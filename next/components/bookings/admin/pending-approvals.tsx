"use client";

import { useEffect, useRef } from "react";
import { CalendarCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { AdminCancelButton, DecisionDialog } from "@/components/bookings/admin/decision-actions";
import { BookingCard } from "@/components/bookings/booking-card";
import { useBookingFormat } from "@/components/bookings/use-booking-format";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback, useFeedback } from "@/components/ui/feedback";
import { ACTIVE_STATUSES, type Booking } from "@/lib/bookings/types";

/**
 * Pending approvals: every PENDING request (oldest start first) with the requester, "Approve" (optional note)
 * and "Reject" (reason). A request whose time has passed can only be rejected. `linked` is the booking of a
 * notification link (?booking=<id>) when it is not pending any more.
 */
export function PendingApprovals({
  bookings,
  total,
  highlight,
  linked,
  now,
}: {
  bookings: Booking[];
  total: number;
  highlight: string | null;
  linked: Booking | null;
  now: number;
}) {
  const t = useTranslations("bookings.admin.pending");
  const fmt = useBookingFormat();
  const [feedback, setFeedback] = useFeedback();
  const highlightRef = useRef<HTMLElement | null>(null);
  const scrolled = useRef(false);

  useEffect(() => {
    if (scrolled.current || !highlightRef.current) return;
    scrolled.current = true;
    highlightRef.current.scrollIntoView({ block: "center" });
    highlightRef.current.focus({ preventScroll: true });
  }, []);

  const actions = (booking: Booking) => {
    if (booking.status !== "PENDING") {
      return ACTIVE_STATUSES.includes(booking.status) && Date.parse(booking.endsAt) > now ? (
        <AdminCancelButton booking={booking} onDone={setFeedback} />
      ) : undefined;
    }
    const ended = Date.parse(booking.endsAt) <= now;
    return (
      <>
        <DecisionDialog booking={booking} mode="reject" onDone={setFeedback} />
        {!ended && <DecisionDialog booking={booking} mode="approve" onDone={setFeedback} />}
      </>
    );
  };

  return (
    <section aria-labelledby="pending-title" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="pending-title" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("count", { count: total })}</p>
      </div>
      <InlineFeedback feedback={feedback} />

      {linked && (
        <section aria-labelledby="pending-linked" className="space-y-2">
          <h3 id="pending-linked" className="text-sm font-semibold text-muted-foreground">
            {t("fromNotification")}
          </h3>
          <BookingCard
            ref={highlightRef}
            booking={linked}
            showRequester
            highlighted
            headingLevel="h4"
            actions={actions(linked)}
          />
        </section>
      )}

      {bookings.length === 0 ? (
        <EmptyState icon={CalendarCheck} headingLevel="h3" title={t("empty")} description={t("emptyHint")} />
      ) : (
        <ol className="grid gap-3 lg:grid-cols-2">
          {bookings.map((booking) => {
            const ended = Date.parse(booking.endsAt) <= now;
            const isHighlighted = booking.id === highlight && !linked;
            return (
              <li key={booking.id}>
                <BookingCard
                  ref={isHighlighted ? highlightRef : undefined}
                  booking={booking}
                  showRequester
                  highlighted={isHighlighted}
                  className="h-full"
                  badges={ended ? <Badge variant="neutral">{t("ended")}</Badge> : undefined}
                  actions={
                    <>
                      <p className="mr-auto self-center text-xs text-muted-foreground">{t("sentAt", { time: fmt.dateTime(booking.createdAt) })}</p>
                      {actions(booking)}
                    </>
                  }
                />
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
