"use client";

import { useState } from "react";
import { Check, Inbox, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InlineFeedback, type Feedback } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { RatingText, RequestStatusBadge } from "@/components/carpool/badges";
import { Initials } from "@/components/carpool/trip-card";
import { useCarpoolFormat } from "@/components/carpool/use-carpool-format";
import type { TripActionRunner } from "@/components/carpool/trip-actions";
import { DECLINE_MESSAGE_MAX, type TripDetail, type TripRequest } from "@/lib/carpool/types";
import { validateOptionalText } from "@/lib/carpool/validation";
import { acceptRequestAction, declineRequestAction } from "@/app/(back)/dashboard/carpool/actions";

export const REQUESTS_ANCHOR = "requests";

/** Decline dialog: optional message sent to the passenger with the notification. */
function DeclineDialog({
  request,
  open,
  onOpenChange,
  onDecline,
}: {
  request: TripRequest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDecline: (request: TripRequest, message: string) => Promise<void>;
}) {
  const t = useTranslations("carpool.requests");
  const tValidation = useTranslations("carpool.validation");
  const tActions = useTranslations("common.actions");
  const format = useCarpoolFormat();
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const name = request ? format.name(request.passenger) : "";

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!request || pending) return;
    const check = validateOptionalText(message, "decline");
    if (check.error) {
      setError(tValidation(check.error.key, check.error.values ?? {}));
      return;
    }
    setPending(true);
    try {
      await onDecline(request, check.text);
      setMessage("");
      setError(undefined);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) onOpenChange(value);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("declineTitle", { name })}</DialogTitle>
          <DialogDescription>{t("declineText", { name })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-5">
          <Field id="decline-message" label={t("declineMessage", { name })} hint={t("declineHint", { max: DECLINE_MESSAGE_MAX })} error={error}>
            {(control) => (
              <Textarea {...control} rows={3} maxLength={DECLINE_MESSAGE_MAX} value={message} onChange={(event) => setMessage(event.target.value)} />
            )}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              {tActions("cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={pending} aria-busy={pending || undefined}>
              {pending && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {t("confirmDecline")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The driver's "Seat requests": pending first (Accept / Decline), then the answered ones. Accepting never
 * overbooks (the API answers TRIP_FULL); the list refreshes live when a passenger sends or cancels a request.
 */
export function RequestsManager({
  trip,
  now,
  online,
  busy,
  feedback,
  run,
}: {
  trip: TripDetail;
  now: number;
  online: boolean;
  busy: boolean;
  feedback: Feedback | null;
  run: TripActionRunner;
}) {
  const t = useTranslations("carpool.requests");
  const format = useCarpoolFormat();
  const [declining, setDeclining] = useState<TripRequest | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const requests = trip.requests ?? [];
  const pendingCount = requests.filter((request) => request.status === "PENDING").length;
  const departed = new Date(trip.departureAt).getTime() <= now;
  const open = (trip.status === "OPEN" || trip.status === "FULL") && !departed;

  const accept = async (request: TripRequest) => {
    setActing(request.id);
    try {
      await run(REQUESTS_ANCHOR, () => acceptRequestAction(request.id));
    } finally {
      setActing(null);
    }
  };

  return (
    <section aria-labelledby="requests-title" className="space-y-4 rounded-3xl border bg-card p-4 text-card-foreground sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="requests-title" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground" data-testid="pending-requests">
          {t("pendingCount", { count: pendingCount })}
        </p>
      </div>
      <InlineFeedback feedback={feedback} />
      {requests.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Inbox className="h-4 w-4" aria-hidden="true" />
          {t("empty")}
        </p>
      ) : (
        <ul className="divide-y">
          {requests.map((request) => {
            const name = format.name(request.passenger);
            const tooMany = request.seats > trip.seatsLeft;
            return (
              <li key={request.id} data-request-id={request.id} data-status={request.status} className="space-y-3 py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="flex min-w-0 items-center gap-3">
                    <Initials firstname={request.passenger.firstname} lastname={request.passenger.lastname} />
                    <span className="min-w-0 text-sm">
                      <span className="block font-medium">{name}</span>
                      <RatingText rating={request.passenger} className="text-xs" />
                    </span>
                  </p>
                  <RequestStatusBadge status={request.status} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("seats", { count: request.seats })} · <time dateTime={request.createdAt}>{t("sent", { time: format.dateTime(request.createdAt) })}</time>
                </p>
                {request.message && (
                  <blockquote className="whitespace-pre-wrap break-words rounded-2xl bg-muted px-3 py-2 text-sm">
                    <span className="sr-only">{t("messageFrom", { name })} </span>
                    {request.message}
                  </blockquote>
                )}
                {request.status === "DECLINED" && request.responseMessage && (
                  <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{t("yourAnswer", { message: request.responseMessage })}</p>
                )}
                {request.status === "PENDING" && open && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void accept(request)}
                      disabled={busy || !online || tooMany || trip.status !== "OPEN"}
                      aria-label={t("acceptLabel", { name })}
                      aria-busy={acting === request.id || undefined}
                    >
                      {acting === request.id ? (
                        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      ) : (
                        <Check className="h-4 w-4" aria-hidden="true" />
                      )}
                      {t("accept")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setDeclining(request)}
                      disabled={busy || !online}
                      aria-label={t("declineLabel", { name })}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                      {t("decline")}
                    </Button>
                    {(tooMany || trip.status !== "OPEN") && <p className="text-xs text-muted-foreground">{t("notEnoughSeats")}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <DeclineDialog
        request={declining}
        open={declining !== null}
        onOpenChange={(value) => {
          if (!value) setDeclining(null);
        }}
        onDecline={async (request, message) => {
          await run(REQUESTS_ANCHOR, () => declineRequestAction(request.id, message));
          setDeclining(null);
        }}
      />
    </section>
  );
}
