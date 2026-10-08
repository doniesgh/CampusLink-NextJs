"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarPlus, CalendarX2, ChevronLeft, ChevronRight, CloudOff, RefreshCw } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { cancelBookingAction } from "@/app/(back)/dashboard/bookings/actions";
import { BookingCard } from "@/components/bookings/booking-card";
import { useBookingFormat } from "@/components/bookings/use-booking-format";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback, useFeedback } from "@/components/ui/feedback";
import { SkeletonList } from "@/components/ui/skeleton";
import { useErrorFormatter } from "@/lib/i18n/client";
import { invalidateQueries, useOfflineQuery } from "@/lib/offline";
import { myBookingsQuery, type MineScope } from "@/lib/bookings/rules";
import { ACTIVE_STATUSES, bookingResourceName, type Booking, type BookingList } from "@/lib/bookings/types";
import { cn } from "@/lib/utils";

export type InitialMine = { data: BookingList | null; savedAt: number };

const PAGE_SIZE = 20;

/** A booking from a notification link that is not on the current page of the list (GET /bookings/:id). */
function LinkedBooking({ id }: { id: string }) {
  const t = useTranslations("bookings.mine");
  const { data } = useOfflineQuery<Booking>(["bookings", "detail", id], `/bookings/${id}`, { reportLastUpdated: false });
  if (!data?.id) return null;
  return (
    <section aria-labelledby="linked-booking" className="space-y-2">
      <h3 id="linked-booking" className="text-sm font-semibold text-muted-foreground">
        {t("fromNotification")}
      </h3>
      <BookingCard booking={data} highlighted />
    </section>
  );
}

/**
 * "My bookings": Upcoming / Past (pages of 20), each booking with its status and decision; upcoming
 * PENDING / CONFIRMED bookings can be cancelled before they start. Readable offline (useOfflineQuery,
 * the first page is rendered on the server). `highlight` (notification link ?booking=<id>) is scrolled to.
 */
export function MyBookings({
  scope,
  now,
  online,
  initial,
  highlight,
  onScope,
  onBook,
}: {
  scope: MineScope;
  now: number;
  online: boolean;
  initial: InitialMine;
  highlight: string | null;
  onScope: (scope: MineScope) => void;
  onBook: () => void;
}) {
  const t = useTranslations("bookings.mine");
  const tStates = useTranslations("common.states");
  const tActions = useTranslations("common.actions");
  const format = useFormatter();
  const fmt = useBookingFormat();
  const errors = useErrorFormatter();
  const [feedback, setFeedback] = useFeedback();
  const [page, setPage] = useState(1);
  const query = myBookingsQuery(scope, page, PAGE_SIZE);
  const seeded = scope === "upcoming" && page === 1 && initial.data !== null;
  const { data, savedAt, isLoading, isValidating, error, refresh, mutate } = useOfflineQuery<BookingList>(query.key, query.path, {
    fallbackData: seeded ? (initial.data ?? undefined) : undefined,
    fallbackSavedAt: seeded ? initial.savedAt : undefined,
    revalidateOnMount: !seeded,
  });

  const highlightRef = useRef<HTMLElement | null>(null);
  const scrolledTo = useRef<string | null>(null);
  const items = Array.isArray(data?.items) ? data.items : [];
  const found = highlight ? items.some((booking) => booking.id === highlight) : false;

  useEffect(() => {
    if (!highlight || !found || scrolledTo.current === highlight || !highlightRef.current) return;
    scrolledTo.current = highlight;
    highlightRef.current.scrollIntoView({ block: "center" });
    highlightRef.current.focus({ preventScroll: true });
  }, [highlight, found]);

  const cancel = async (booking: Booking) => {
    const result = await cancelBookingAction(booking.id, booking.version);
    if (result.ok) {
      const updated = result.data?.booking;
      if (updated) {
        mutate((current) => (current ? { ...current, items: current.items.map((item) => (item.id === updated.id ? updated : item)) } : current));
      }
      setFeedback({ type: "success", message: result.message ?? t("cancelledShort") });
      invalidateQueries("bookings");
      return;
    }
    setFeedback({ type: "error", message: result.message ?? "" });
    if (result.data?.reload) invalidateQueries("bookings");
  };

  const pages = data ? Math.max(1, Math.ceil((data.total ?? 0) / Math.max(1, data.limit ?? PAGE_SIZE))) : 1;
  const stale = savedAt !== null && (!online || error !== null);

  let content: React.ReactNode;
  if (isLoading) {
    content = <SkeletonList rows={3} label={tStates("loading")} />;
  } else if (!data) {
    const offline = !online || error?.isNetworkError || error?.code === "OFFLINE";
    content = (
      <EmptyState
        icon={offline ? CloudOff : RefreshCw}
        headingLevel="h3"
        title={offline ? t("notSaved") : t("loadError")}
        description={offline ? t("notSavedHint") : error ? errors.message(error) : undefined}
        action={
          offline ? undefined : (
            <Button variant="outline" className="rounded-full" onClick={() => void refresh()} disabled={isValidating}>
              {tActions("tryAgain")}
            </Button>
          )
        }
      />
    );
  } else if (items.length === 0) {
    content = (
      <EmptyState
        icon={scope === "upcoming" ? CalendarPlus : CalendarX2}
        headingLevel="h3"
        title={scope === "upcoming" ? t("emptyUpcoming") : t("emptyPast")}
        description={scope === "upcoming" ? t("emptyUpcomingHint") : undefined}
        action={
          scope === "upcoming" ? (
            <Button className="rounded-full" onClick={onBook}>
              {t("bookNow")}
            </Button>
          ) : undefined
        }
      />
    );
  } else {
    content = (
      <ol className="space-y-3">
        {items.map((booking) => {
          const cancellable = ACTIVE_STATUSES.includes(booking.status) && Date.parse(booking.startsAt) > now;
          const isHighlighted = booking.id === highlight;
          return (
            <li key={booking.id}>
              <BookingCard
                ref={isHighlighted ? highlightRef : undefined}
                booking={booking}
                highlighted={isHighlighted}
                actions={
                  cancellable ? (
                    online ? (
                      <ConfirmDialog
                        trigger={
                          <Button variant="outline" size="sm" className="rounded-full text-destructive hover:text-destructive">
                            {t("cancel")}
                          </Button>
                        }
                        title={t("cancelTitle")}
                        description={t("cancelDescription", { resource: bookingResourceName(booking), when: fmt.when(booking.startsAt, booking.endsAt) })}
                        confirmLabel={t("confirmCancel")}
                        cancelLabel={t("keep")}
                        onConfirm={() => cancel(booking)}
                      />
                    ) : (
                      <Button variant="outline" size="sm" className="rounded-full" disabled title={t("cancelOffline")}>
                        {t("cancel")}
                      </Button>
                    )
                  ) : undefined
                }
              />
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <div role="group" aria-label={t("scopeLabel")} className="inline-flex self-start rounded-full bg-muted p-1">
          {(["upcoming", "past"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={value === scope}
              onClick={() => {
                setPage(1);
                onScope(value);
              }}
              className={cn(
                "min-h-9 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                value === scope ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t(value)}
            </button>
          ))}
        </div>
      </div>

      <InlineFeedback feedback={feedback} />
      {!online && <p className="text-sm text-muted-foreground">{t("cancelOffline")}</p>}
      {stale && <p className="text-sm text-muted-foreground">{t("savedCopy", { time: format.dateTime(new Date(savedAt), "dayMonthTime") })}</p>}

      {highlight && data && !found && online && <LinkedBooking id={highlight} />}

      {content}

      {data && pages > 1 && (
        <nav aria-label={t("pagination")} className="flex items-center justify-between gap-3">
          <Button variant="outline" size="sm" className="rounded-full" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {tActions("previous")}
          </Button>
          <p className="text-sm text-muted-foreground">{t("pageOf", { page, pages })}</p>
          <Button variant="outline" size="sm" className="rounded-full" disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))}>
            {tActions("next")}
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </nav>
      )}
    </div>
  );
}
