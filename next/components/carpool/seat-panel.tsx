"use client";

import { useState } from "react";
import { Armchair, CircleCheck, Hourglass, Loader2, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { InlineFeedback, type Feedback } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCarpoolFormat } from "@/components/carpool/use-carpool-format";
import { DEFAULT_SETTINGS, REQUEST_MESSAGE_MAX, type TripDetail } from "@/lib/carpool/types";
import { validateSeatRequest } from "@/lib/carpool/validation";
import type { TripActionRunner } from "@/components/carpool/trip-actions";
import { cancelRequestAction, requestSeatAction } from "@/app/(back)/dashboard/carpool/actions";

export const SEAT_ANCHOR = "seat";

/**
 * The passenger side of a trip: "Request a seat" (seats + optional message), then the request's state with
 * "Cancel my request" (pending) or "Give up my seat" (accepted, before the departure).
 */
export function SeatPanel({
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
  const t = useTranslations("carpool.seat");
  const tValidation = useTranslations("carpool.validation");
  const format = useCarpoolFormat();
  const [seats, setSeats] = useState(1);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const departed = new Date(trip.departureAt).getTime() <= now;
  const request = trip.myRequest;
  const active = request && (request.status === "PENDING" || request.status === "ACCEPTED");
  const maxSeats = Math.max(1, Math.min(DEFAULT_SETTINGS.maxRequestSeats, trip.seatsLeft));
  const canRequest = !active && trip.status === "OPEN" && !departed && trip.seatsLeft > 0;
  const driverName = format.name(trip.driver);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const check = validateSeatRequest({ seats, message });
    const fieldErrors = Object.fromEntries(
      Object.entries(check.errors).flatMap(([field, error]) => (error ? [[field, tValidation(error.key, error.values ?? {})]] : []))
    );
    setErrors(fieldErrors);
    if (!check.payload) return;
    const result = await run(SEAT_ANCHOR, () => requestSeatAction(trip.id, { seats, message }));
    if (result?.ok) {
      setMessage("");
      setSeats(1);
    } else if (result?.fieldErrors) {
      setErrors(result.fieldErrors);
    }
  };

  let body: React.ReactNode = null;
  if (trip.status === "CANCELLED") {
    body = null;
  } else if (request?.status === "ACCEPTED") {
    body = (
      <div className="space-y-3">
        <p className="flex items-start gap-2 text-sm" data-testid="seat-state" data-state="ACCEPTED">
          <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
          {departed ? t("wasOnBoard") : t("accepted", { count: request.seats })}
        </p>
        {!departed && (
          <ConfirmDialog
            trigger={
              <Button type="button" variant="outline" disabled={busy || !online}>
                {t("giveUp")}
              </Button>
            }
            title={t("giveUpTitle")}
            description={t("giveUpText")}
            confirmLabel={t("confirmGiveUp")}
            cancelLabel={t("keep")}
            onConfirm={async () => {
              await run(SEAT_ANCHOR, () => cancelRequestAction(request.id));
            }}
          />
        )}
      </div>
    );
  } else if (request?.status === "PENDING") {
    body = (
      <div className="space-y-3">
        <p className="flex items-start gap-2 text-sm" data-testid="seat-state" data-state="PENDING">
          <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {t("pending", { count: request.seats, name: driverName })}
        </p>
        <ConfirmDialog
          trigger={
            <Button type="button" variant="outline" disabled={busy || !online}>
              {t("cancelRequest")}
            </Button>
          }
          title={t("cancelRequestTitle")}
          description={t("cancelRequestText")}
          confirmLabel={t("confirmCancelRequest")}
          cancelLabel={t("keep")}
          onConfirm={async () => {
            await run(SEAT_ANCHOR, () => cancelRequestAction(request.id));
          }}
        />
      </div>
    );
  } else if (departed || trip.status === "COMPLETED") {
    body = <p className="text-sm text-muted-foreground">{t("departed")}</p>;
  } else if (!canRequest) {
    body = (
      <p className="text-sm text-muted-foreground" data-testid="seat-state" data-state="FULL">
        {t("full")}
      </p>
    );
  } else {
    body = (
      <form onSubmit={submit} noValidate className="space-y-4">
        {request?.status === "DECLINED" && <p className="text-sm text-muted-foreground">{t("declinedBefore")}</p>}
        <Field id="seat-request-seats" label={t("seats")} error={errors.seats}>
          {(control) => (
            <Select {...control} value={String(Math.min(seats, maxSeats))} onChange={(event) => setSeats(Number(event.target.value))}>
              {Array.from({ length: maxSeats }, (_, index) => index + 1).map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="seat-request-message" label={t("message")} hint={t("messageHint", { max: REQUEST_MESSAGE_MAX })} error={errors.message}>
          {(control) => (
            <Textarea {...control} rows={3} maxLength={REQUEST_MESSAGE_MAX} value={message} onChange={(event) => setMessage(event.target.value)} />
          )}
        </Field>
        <Button type="submit" variant="highlight" disabled={busy || !online} aria-busy={busy || undefined} className="w-full sm:w-auto">
          {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          {t("submit")}
        </Button>
      </form>
    );
  }

  if (!body && !feedback) return null;
  return (
    <section aria-labelledby="seat-title" className="space-y-4 rounded-3xl border bg-card p-4 text-card-foreground sm:p-6">
      <h2 id="seat-title" className="flex items-center gap-2 text-lg font-semibold">
        <Armchair className="h-5 w-5 text-primary" aria-hidden="true" />
        {canRequest ? t("requestTitle") : t("title")}
      </h2>
      {body}
      <InlineFeedback feedback={feedback} />
    </section>
  );
}
