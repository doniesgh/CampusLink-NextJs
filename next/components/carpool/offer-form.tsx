"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CarFront, Loader2, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { InlineFeedback, type Feedback } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup } from "@/components/ui/radio-group";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MY_LOCATION, PlacePicker } from "@/components/carpool/place-picker";
import { useCarpoolFormat } from "@/components/carpool/use-carpool-format";
import { useGeolocation } from "@/components/carpool/use-geolocation";
import { useHydrated } from "@/components/carpool/use-hydrated";
import { addDays, dateKey } from "@/lib/datetime";
import { useOfflineQuery, useOnlineStatus } from "@/lib/offline";
import { roadDistanceKm, suggestedPrice, type LatLng } from "@/lib/carpool/geo";
import { myTripsQuery, tripHref } from "@/lib/carpool/paths";
import { LABEL_MAX, NOTES_MAX, PREFERENCE_KEYS, type CarpoolSettings, type Direction, type Place, type PreferenceKey, type TripList } from "@/lib/carpool/types";
import { validateTrip, type ValidationErrors } from "@/lib/carpool/validation";
import { createTripAction } from "@/app/(back)/dashboard/carpool/actions";

const FIELD_ORDER = ["place", "meetingPoint", "date", "time", "seats", "price", "notes"] as const;
const FIELD_IDS: Record<string, string> = {
  place: "offer-place",
  meetingPoint: "offer-meeting-point",
  date: "offer-date",
  time: "offer-time",
  seats: "offer-seats",
  price: "offer-price",
  notes: "offer-notes",
};

/** Current time for the checks run on submit (outside render). */
const currentTime = () => Date.now();

/** "Upcoming" active trips (OPEN / FULL) of the driver, for the "2 of 5 upcoming trips" line. */
function countActive(list: TripList | undefined): number | null {
  if (!list || !Array.isArray(list.items)) return null;
  return list.items.filter((trip) => trip.status === "OPEN" || trip.status === "FULL").length;
}

/**
 * "Offer a trip": direction, the off-campus place (curated place or the driver's position, + an optional
 * meeting point), date and time (campus time), seats, price per seat prefilled with the suggested shared
 * cost (distance × cost per km / (seats + 1), same formula as the API), preferences and notes.
 * Checked here, again by the Server Action and by the API; success opens the new trip.
 */
export function OfferForm({
  places,
  settings,
  now,
  initialDriverTrips,
}: {
  places: readonly Place[];
  settings: CarpoolSettings;
  now: number;
  initialDriverTrips: { data: TripList | null; savedAt: number };
}) {
  const t = useTranslations("carpool.offer");
  const tDirections = useTranslations("carpool.directions");
  const tValidation = useTranslations("carpool.validation");
  const format = useCarpoolFormat();
  const router = useRouter();
  const online = useOnlineStatus();
  const geolocation = useGeolocation();
  const formRef = useRef<HTMLFormElement>(null);
  const hydrated = useHydrated();

  const today = dateKey(now);
  const [direction, setDirection] = useState<Direction>("TO_CAMPUS");
  const [placeValue, setPlaceValue] = useState("");
  const [meetingPoint, setMeetingPoint] = useState("");
  const [date, setDate] = useState(addDays(today, 1));
  const [time, setTime] = useState("08:00");
  const [seats, setSeats] = useState(3);
  const [price, setPrice] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<Record<PreferenceKey, boolean>>({ music: true, smoking: false, pets: false, womenOnly: false });
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pending, setPending] = useState(false);

  const driverQuery = myTripsQuery("driver", "upcoming", 1, 50);
  const driverTrips = useOfflineQuery<TripList>(driverQuery.key, driverQuery.path, {
    fallbackData: initialDriverTrips.data ?? undefined,
    fallbackSavedAt: initialDriverTrips.savedAt,
    revalidateOnMount: !initialDriverTrips.data,
  });
  const active = countActive(driverTrips.data);
  const limitReached = active !== null && active >= settings.maxUpcomingTrips;

  const geo = geolocation.state;
  const selected: (LatLng & { label?: string }) | null =
    placeValue === MY_LOCATION && geo.status === "located"
      ? { lat: Number(geo.point.lat.toFixed(5)), lng: Number(geo.point.lng.toFixed(5)) }
      : (places.find((item) => item.id === placeValue) ?? null);
  const distance = selected ? roadDistanceKm(selected, settings.campus, settings) : null;
  const suggestion = distance !== null ? suggestedPrice(distance, seats, settings) : null;
  const priceValue = price ?? (suggestion !== null ? String(suggestion) : "");

  const translate = (fieldErrors: ValidationErrors) =>
    Object.fromEntries(Object.entries(fieldErrors).flatMap(([field, error]) => (error ? [[field, tValidation(error.key, error.values ?? {})]] : [])));

  const focusFirstError = (fieldErrors: Record<string, string>) => {
    const first = FIELD_ORDER.find((field) => fieldErrors[field]);
    if (first) formRef.current?.querySelector<HTMLElement>(`#${FIELD_IDS[first]}`)?.focus();
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const input = { direction, place: selected, meetingPoint, date, time, seats, price: priceValue, preferences, notes };
    const check = validateTrip(input, currentTime(), settings, settings.campus);
    const fieldErrors = translate(check.errors);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) {
      setFeedback({ type: "error", message: t("fixErrors") });
      focusFirstError(fieldErrors);
      return;
    }
    setPending(true);
    setFeedback(null);
    try {
      const result = await createTripAction(input);
      if (result.ok && result.data?.id) {
        router.push(`${tripHref(result.data.id)}?done=created`);
        return;
      }
      const serverErrors = result.fieldErrors ?? {};
      setErrors(serverErrors);
      setFeedback({ type: "error", message: result.message ?? t("failed") });
      focusFirstError(serverErrors);
      if (result.code === "TRIP_LIMIT_REACHED") void driverTrips.refresh();
    } catch {
      setFeedback({ type: "error", message: t("offline") });
    } finally {
      setPending(false);
    }
  };

  const otherEnd = direction === "TO_CAMPUS" ? t("arrivalCampus", { campus: settings.campus.label }) : t("departureCampus", { campus: settings.campus.label });

  return (
    <form ref={formRef} noValidate onSubmit={submit} data-ready={hydrated ? "true" : undefined} className="space-y-6 rounded-3xl border bg-card p-4 text-card-foreground sm:p-6" aria-labelledby="offer-title">
      <div className="space-y-1">
        <h2 id="offer-title" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
        {active !== null && (
          <p className="text-sm text-muted-foreground" data-testid="offer-limit">
            {t("limit", { count: active, max: settings.maxUpcomingTrips })}
          </p>
        )}
      </div>

      {limitReached && <InlineFeedback feedback={{ type: "info", message: t("limitReached", { max: settings.maxUpcomingTrips }) }} />}

      <RadioGroup
        legend={t("direction")}
        name="direction"
        value={direction}
        onValueChange={(value) => setDirection(value as Direction)}
        className="sm:flex sm:flex-wrap sm:gap-x-6 sm:space-y-0 [&>legend]:w-full"
        options={[
          { value: "TO_CAMPUS", label: tDirections("TO_CAMPUS") },
          { value: "FROM_CAMPUS", label: tDirections("FROM_CAMPUS") },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <PlacePicker
            id={FIELD_IDS.place}
            label={direction === "TO_CAMPUS" ? t("departure") : t("destination")}
            hint={otherEnd}
            error={errors.place}
            places={places}
            value={placeValue}
            onChange={(value) => {
              setPlaceValue(value);
              setErrors((current) => {
                const next = { ...current };
                delete next.place;
                return next;
              });
            }}
            geo={geo}
            onLocate={geolocation.locate}
            emptyLabel={t("placeChoose")}
            emptyDisabled
          />
        </div>
        <Field id={FIELD_IDS.meetingPoint} label={t("meetingPoint")} hint={t("meetingPointHint")} error={errors.meetingPoint} className="md:col-span-2">
          {(control) => <Input {...control} value={meetingPoint} maxLength={LABEL_MAX} onChange={(event) => setMeetingPoint(event.target.value)} autoComplete="off" />}
        </Field>
        <Field id={FIELD_IDS.date} label={t("date")} error={errors.date}>
          {(control) => (
            <Input {...control} type="date" required value={date} min={today} max={addDays(today, settings.maxDaysAhead)} onChange={(event) => setDate(event.target.value)} />
          )}
        </Field>
        <Field id={FIELD_IDS.time} label={t("time")} hint={t("timeHint")} error={errors.time}>
          {(control) => <Input {...control} type="time" required step={300} value={time} onChange={(event) => setTime(event.target.value)} />}
        </Field>
        <Field id={FIELD_IDS.seats} label={t("seats")} error={errors.seats}>
          {(control) => (
            <Select {...control} value={String(seats)} onChange={(event) => setSeats(Number(event.target.value))}>
              {Array.from({ length: settings.maxSeats - settings.minSeats + 1 }, (_, index) => settings.minSeats + index).map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          id={FIELD_IDS.price}
          label={t("price")}
          error={errors.price}
          hint={
            suggestion !== null && distance !== null
              ? t("priceHint", { price: format.km(suggestion), km: format.km(distance) })
              : t("priceHintNoPlace")
          }
        >
          {(control) => (
            <div className="flex gap-2">
              <Input
                {...control}
                type="number"
                inputMode="decimal"
                min={0}
                max={settings.maxPricePerSeat}
                step={0.1}
                value={priceValue}
                onChange={(event) => setPrice(event.target.value)}
                className="min-w-0"
              />
              {price !== null && suggestion !== null && Number(price) !== suggestion && (
                <Button type="button" variant="outline" className="shrink-0" onClick={() => setPrice(null)}>
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">{t("useSuggested")}</span>
                </Button>
              )}
            </div>
          )}
        </Field>
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-medium">{t("preferences")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {PREFERENCE_KEYS.map((key) => (
            <CheckboxField
              key={key}
              id={`offer-pref-${key}`}
              label={t(`pref.${key}`)}
              description={key === "womenOnly" ? t("womenOnlyHint") : undefined}
              checked={preferences[key]}
              onChange={(event) => setPreferences((current) => ({ ...current, [key]: event.target.checked }))}
            />
          ))}
        </div>
      </fieldset>

      <Field id={FIELD_IDS.notes} label={t("notes")} hint={t("notesHint", { max: NOTES_MAX })} error={errors.notes}>
        {(control) => <Textarea {...control} value={notes} maxLength={NOTES_MAX} rows={3} onChange={(event) => setNotes(event.target.value)} />}
      </Field>

      <InlineFeedback feedback={feedback} />
      {!online && <p className="text-sm text-muted-foreground">{t("offline")}</p>}

      <div className="flex justify-end">
        <Button type="submit" variant="highlight" disabled={pending || !online || limitReached} aria-busy={pending || undefined} className="w-full sm:w-auto">
          {pending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CarFront className="h-4 w-4" aria-hidden="true" />}
          {pending ? t("submitting") : t("submit")}
        </Button>
      </div>
    </form>
  );
}
