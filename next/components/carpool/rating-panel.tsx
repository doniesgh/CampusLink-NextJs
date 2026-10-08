"use client";

import { useId, useState } from "react";
import { Loader2, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { InlineFeedback, type Feedback } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Initials } from "@/components/carpool/trip-card";
import { useCarpoolFormat } from "@/components/carpool/use-carpool-format";
import type { TripActionRunner } from "@/components/carpool/trip-actions";
import { cn } from "@/lib/utils";
import { RATING_COMMENT_MAX, type Participant, type TripDetail } from "@/lib/carpool/types";
import { validateRating } from "@/lib/carpool/validation";
import { rateParticipantAction } from "@/app/(back)/dashboard/carpool/actions";

export const RATING_ANCHOR = "rating";

/** 1–5 stars as native radios (arrow keys, `getByRole("radio", { name: "4 stars" })`), drawn as stars. */
function StarInput({ name, legend, value, onChange, error }: { name: string; legend: string; value: number; onChange: (value: number) => void; error?: string }) {
  const t = useTranslations("carpool.rating");
  const baseId = useId();
  const errorId = `${baseId}-error`;
  return (
    <fieldset aria-describedby={error ? errorId : undefined}>
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((score) => {
          const id = `${baseId}-${score}`;
          return (
            <span key={score} className="relative">
              {/* The radio covers its star (transparent): clicks, taps and arrow keys use the native control. */}
              <input
                id={id}
                type="radio"
                name={name}
                value={score}
                checked={value === score}
                onChange={() => onChange(score)}
                className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer appearance-none rounded-xl opacity-0"
              />
              <label
                htmlFor={id}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors peer-hover:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
              >
                <Star className={cn("h-6 w-6", score <= value && "fill-highlight text-highlight")} aria-hidden="true" />
                <span className="sr-only">{t("stars", { count: score })}</span>
              </label>
            </span>
          );
        })}
      </div>
      {error && (
        <p id={errorId} className="mt-1 text-sm text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function RatingForm({ trip, person, online, busy, run }: { trip: TripDetail; person: Participant; online: boolean; busy: boolean; run: TripActionRunner }) {
  const t = useTranslations("carpool.rating");
  const tValidation = useTranslations("carpool.validation");
  const format = useCarpoolFormat();
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const name = format.name(person);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const check = validateRating({ score, comment });
    const fieldErrors = Object.fromEntries(
      Object.entries(check.errors).flatMap(([field, error]) => (error ? [[field, tValidation(error.key, error.values ?? {})]] : []))
    );
    setErrors(fieldErrors);
    if (!check.payload) return;
    setPending(true);
    try {
      await run(RATING_ANCHOR, () => rateParticipantAction(trip.id, { userId: person.id, score, comment, name }));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-3" data-rate-user={person.id}>
      <StarInput name={`rating-${person.id}`} legend={t("for", { name })} value={score} onChange={setScore} error={errors.score} />
      <Field id={`rating-comment-${person.id}`} label={t("comment")} error={errors.comment}>
        {(control) => (
          <Textarea {...control} rows={2} maxLength={RATING_COMMENT_MAX} value={comment} onChange={(event) => setComment(event.target.value)} className="min-h-16" />
        )}
      </Field>
      <Button type="submit" size="sm" disabled={busy || pending || !online} aria-busy={pending || undefined}>
        {pending && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
        {t("submit")}
      </Button>
    </form>
  );
}

/** "Rate your trip": every other participant, once each (1–5 stars + comment), one hour after the departure. */
export function RatingPanel({
  trip,
  online,
  busy,
  feedback,
  run,
}: {
  trip: TripDetail;
  online: boolean;
  busy: boolean;
  feedback: Feedback | null;
  run: TripActionRunner;
}) {
  const t = useTranslations("carpool.rating");
  const format = useCarpoolFormat();
  const others = (trip.participants ?? []).filter((person) => !person.me);
  if (!trip.canRate || others.length === 0) return null;
  const allDone = others.every((person) => person.myRating);

  return (
    <section aria-labelledby="rating-title" className="space-y-4 rounded-3xl border bg-card p-4 text-card-foreground sm:p-6">
      <div className="space-y-1">
        <h2 id="rating-title" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{allDone ? t("allDone") : t("intro")}</p>
      </div>
      <InlineFeedback feedback={feedback} />
      <ul className="divide-y">
        {others.map((person) => (
          <li key={person.id} className="space-y-3 py-4 first:pt-0 last:pb-0" data-participant-id={person.id} data-rated={person.myRating ? "true" : "false"}>
            <p className="flex items-center gap-3 text-sm font-medium">
              <Initials firstname={person.firstname} lastname={person.lastname} className="h-8 w-8" />
              {format.name(person)}
            </p>
            {person.myRating ? (
              <div className="text-sm">
                <p className="flex items-center gap-1">
                  <Star className="h-4 w-4 fill-highlight text-highlight" aria-hidden="true" />
                  {t("given", { name: format.name(person), score: person.myRating.score })}
                </p>
                {person.myRating.comment && <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{person.myRating.comment}</p>}
              </div>
            ) : (
              <RatingForm trip={trip} person={person} online={online} busy={busy} run={run} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
