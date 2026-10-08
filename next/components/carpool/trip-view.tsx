"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Ban, CarFront, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import Link from "@/components/ui/app-link";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { InlineFeedback, type Feedback } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { SkeletonList } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { DirectionBadge, TripStatusBadge } from "@/components/carpool/badges";
import { RatingPanel } from "@/components/carpool/rating-panel";
import { RequestsManager } from "@/components/carpool/requests-manager";
import { SeatPanel } from "@/components/carpool/seat-panel";
import type { TripActionResult, TripActionRunner } from "@/components/carpool/trip-actions";
import { RouteText } from "@/components/carpool/trip-card";
import { TripChat } from "@/components/carpool/trip-chat";
import { TripDetails } from "@/components/carpool/trip-details";
import { TripNotFound } from "@/components/carpool/trip-not-found";
import { useCarpoolFormat } from "@/components/carpool/use-carpool-format";
import { useHydrated } from "@/components/carpool/use-hydrated";
import { useErrorFormatter } from "@/lib/i18n/client";
import { useOfflineQuery, useOnlineStatus } from "@/lib/offline";
import { useRealtimeEvent } from "@/lib/realtime";
import { useNow } from "@/lib/timetable/client";
import { carpoolHref, tripKey, tripPath } from "@/lib/carpool/paths";
import { CANCEL_REASON_MAX, isParticipant, type MessagePage, type TripDetail } from "@/lib/carpool/types";
import { validateOptionalText } from "@/lib/carpool/validation";
import { cancelTripAction } from "@/app/(back)/dashboard/carpool/actions";

const TRIP_ANCHOR = "trip";

type Anchored = { anchor: string; value: Feedback } | null;
type RealtimeHint = { tripId?: unknown };

function BackLink() {
  const t = useTranslations("carpool.trip");
  return (
    <Link
      href={carpoolHref}
      className="inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {t("back")}
    </Link>
  );
}

/** The driver's "Cancel trip" (optional reason, sent to the passengers). */
function CancelTripDialog({ trip, disabled, run }: { trip: TripDetail; disabled: boolean; run: TripActionRunner }) {
  const t = useTranslations("carpool.trip");
  const tValidation = useTranslations("carpool.validation");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const check = validateOptionalText(reason, "cancel");
    if (check.error) {
      setError(tValidation(check.error.key, check.error.values ?? {}));
      return;
    }
    setPending(true);
    try {
      const result = await run(TRIP_ANCHOR, () => cancelTripAction(trip.id, check.text));
      if (result?.ok) setOpen(false);
      else if (result?.fieldErrors?.reason) setError(result.fieldErrors.reason);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="text-destructive hover:text-destructive" disabled={disabled}>
          <Ban className="h-4 w-4" aria-hidden="true" />
          {t("cancelTrip")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("cancelTripTitle")}</DialogTitle>
          <DialogDescription>{t("cancelTripText")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-5">
          <Field id="cancel-trip-reason" label={t("cancelReasonLabel")} hint={t("cancelReasonHint", { max: CANCEL_REASON_MAX })} error={error}>
            {(control) => <Textarea {...control} rows={3} maxLength={CANCEL_REASON_MAX} value={reason} onChange={(event) => setReason(event.target.value)} />}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              {t("keepTrip")}
            </Button>
            <Button type="submit" variant="destructive" disabled={pending} aria-busy={pending || undefined}>
              {t("confirmCancelTrip")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * /dashboard/carpool/[id]: the trip, the passenger's request or the driver's requests, the real-time chat
 * (driver + accepted passengers), the driver's "Cancel trip" and the ratings after the trip. The trip is an
 * offline query (`carpool:trip:<id>`); actions are Server Actions whose answer replaces it, and the server's
 * hints (`trip:updated` in the trip room, `carpool:request` in the user's room) refresh it live.
 */
export function TripView({
  id,
  viewerId,
  initial,
  initialMessages,
  serverNow,
  created,
}: {
  id: string;
  viewerId: string;
  initial: { data: TripDetail; savedAt: number } | null;
  initialMessages: { data: MessagePage; savedAt: number } | null;
  serverNow: number;
  created: boolean;
}) {
  const t = useTranslations("carpool.trip");
  const tErrors = useTranslations("carpool.errors");
  const errors = useErrorFormatter();
  const format = useCarpoolFormat();
  const online = useOnlineStatus();
  const now = useNow(serverNow);
  const hydrated = useHydrated();
  const { data: trip, isLoading, error, mutate, refresh } = useOfflineQuery<TripDetail>(tripKey(id), tripPath(id), {
    fallbackData: initial?.data,
    fallbackSavedAt: initial?.savedAt,
    revalidateOnMount: !initial,
  });
  const [anchored, setAnchored] = useState<Anchored>(() => (created ? { anchor: TRIP_ANCHOR, value: { type: "success", message: t("created") } } : null));
  const [busy, setBusy] = useState(false);

  // "?done=created" is shown once: drop it from the address (no server round trip).
  useEffect(() => {
    if (!created) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("done");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [created]);

  // Live hints from the server: refresh the trip (seats, status, requests, participants).
  const onHint = (payload: RealtimeHint) => {
    if (payload && payload.tripId === id) void refresh();
  };
  useRealtimeEvent<RealtimeHint>("trip:updated", onHint);
  useRealtimeEvent<RealtimeHint>("carpool:request", onHint);

  const run: TripActionRunner = async (anchor, action) => {
    setBusy(true);
    setAnchored(null);
    let result: TripActionResult | null = null;
    try {
      result = await action();
    } catch {
      result = null;
    } finally {
      setBusy(false);
    }
    if (!result) {
      setAnchored({ anchor, value: { type: "error", message: tErrors("offline") } });
      return null;
    }
    if (result.data?.trip) mutate(result.data.trip);
    else if (result.data?.reload) void refresh();
    if (result.message) setAnchored({ anchor, value: { type: result.ok ? "success" : "error", message: result.message } });
    return result;
  };
  const feedbackFor = (anchor: string) => (anchored?.anchor === anchor ? anchored.value : null);

  if (!trip) {
    if (isLoading) return <SkeletonList rows={4} label={t("loading")} />;
    const missing = error && (error.status === 404 || error.status === 400 || error.status === 403);
    return (
      <TripNotFound
        title={missing ? t("notFoundTitle") : t("loadErrorTitle")}
        description={missing ? t("notFoundText") : error ? (error.isNetworkError ? tErrors("offline") : errors.message(error)) : undefined}
        backLabel={t("back")}
        action={
          !missing ? (
            <Button type="button" variant="outline" className="rounded-full" onClick={() => void refresh()} disabled={!online}>
              {t("retry")}
            </Button>
          ) : undefined
        }
      />
    );
  }

  const departed = new Date(trip.departureAt).getTime() <= now;
  const participant = isParticipant(trip);
  const driver = trip.myRole === "DRIVER";
  const canCancel = driver && (trip.status === "OPEN" || trip.status === "FULL") && !departed;
  const pendingPassenger = !participant && trip.myRequest?.status === "PENDING";

  return (
    <div className="space-y-6" data-testid="trip-view" data-ready={hydrated ? "true" : undefined}>
      <BackLink />

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <DirectionBadge direction={trip.direction} />
          <TripStatusBadge status={trip.status} />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" data-testid="trip-title">
              <RouteText from={trip.departure.label} to={trip.destination.label} className="gap-x-2" />
            </h1>
            <p className="mt-1 text-muted-foreground">
              <time dateTime={trip.departureAt}>{format.when(trip.departureAt, now)}</time>
              {" · "}
              {format.pricePerSeat(trip.pricePerSeat)}
            </p>
          </div>
          {canCancel && <CancelTripDialog trip={trip} disabled={busy || !online} run={run} />}
        </div>
        {trip.status === "CANCELLED" && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm" data-testid="trip-cancelled">
            <p className="font-semibold text-destructive">{trip.cancelledBy === "ADMIN" ? t("cancelledByAdmin") : t("cancelledByDriver")}</p>
            {trip.cancelReason && <p className="mt-1 whitespace-pre-wrap break-words">{t("cancelReason", { reason: trip.cancelReason })}</p>}
          </div>
        )}
        {trip.status !== "CANCELLED" && departed && <p className="text-sm text-muted-foreground">{trip.status === "COMPLETED" ? t("completed") : t("departed")}</p>}
        <InlineFeedback feedback={feedbackFor(TRIP_ANCHOR)} />
        {!online && <p className="text-sm text-muted-foreground">{t("offline")}</p>}
      </header>

      {/* Phones: actions, chat, details. Large screens: actions and details on the left, the chat on the right. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:grid-rows-[auto_1fr] lg:items-start">
        <div className="min-w-0 space-y-6 empty:hidden lg:col-start-1 lg:row-start-1">
          {driver ? (
            <RequestsManager trip={trip} now={now} online={online} busy={busy} feedback={feedbackFor("requests")} run={run} />
          ) : (
            <SeatPanel trip={trip} now={now} online={online} busy={busy} feedback={feedbackFor("seat")} run={run} />
          )}
          <RatingPanel trip={trip} online={online} busy={busy} feedback={feedbackFor("rating")} run={run} />
        </div>
        <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {participant ? (
            <TripChat trip={trip} viewerId={viewerId} now={now} initial={initialMessages} />
          ) : (
            <section aria-labelledby="chat-locked-title" className="rounded-3xl border border-dashed bg-card p-6 text-center text-card-foreground">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-primary">
                {pendingPassenger ? <CarFront className="h-6 w-6" aria-hidden="true" /> : <Lock className="h-6 w-6" aria-hidden="true" />}
              </span>
              <h2 id="chat-locked-title" className="mt-4 font-heading text-base font-semibold">
                {t("chatTitle")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{pendingPassenger ? t("chatLockedPending") : t("chatLocked")}</p>
            </section>
          )}
        </div>
        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          <TripDetails trip={trip} now={now} />
        </div>
      </div>
    </div>
  );
}
