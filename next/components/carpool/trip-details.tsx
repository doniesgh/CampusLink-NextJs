"use client";

import { Banknote, CalendarClock, ExternalLink, Info, MapPin, Route, School, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { PreferenceChips, RatingText } from "@/components/carpool/badges";
import { Initials } from "@/components/carpool/trip-card";
import { useCarpoolFormat } from "@/components/carpool/use-carpool-format";
import { mapLink } from "@/lib/carpool/geo";
import type { TripDetail, TripPlace } from "@/lib/carpool/types";

function Fact({ icon: Icon, term, children }: { icon: typeof MapPin; term: string; children: React.ReactNode }) {
  return (
    <div className="relative min-h-9 min-w-0 pl-12">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span className="absolute left-0 top-0 flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-primary" aria-hidden="true">
          <Icon className="h-4 w-4" />
        </span>
        {term}
      </dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/** A place, with an OpenStreetMap link when the viewer has the exact coordinates (driver, accepted passengers). */
function PlaceText({ place, exact, isCampus }: { place: TripPlace; exact: boolean; isCampus: boolean }) {
  const t = useTranslations("carpool.trip");
  return (
    <span className="block">
      <span className="font-semibold break-words">{place.label}</span>
      {isCampus && (
        <Badge variant="secondary" className="ml-2 align-middle">
          <School className="h-3 w-3" aria-hidden="true" />
          {t("campus")}
        </Badge>
      )}
      {exact && !isCampus && (
        <a
          href={mapLink(place)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 flex w-fit items-center gap-1 rounded text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("openMap")}
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">{t("openMapLabel", { place: place.label })}</span>
        </a>
      )}
    </span>
  );
}

/** "Trip details": places, time, seats, price, distance, driver, preferences, notes and who is on board. */
export function TripDetails({ trip, now }: { trip: TripDetail; now: number }) {
  const t = useTranslations("carpool.trip");
  const tFormat = useTranslations("carpool.format");
  const format = useCarpoolFormat();
  const toCampus = trip.direction === "TO_CAMPUS";

  return (
    <section aria-labelledby="trip-details-title" className="space-y-5 rounded-3xl border bg-card p-4 text-card-foreground sm:p-6">
      <h2 id="trip-details-title" className="text-lg font-semibold">
        {t("details")}
      </h2>
      <dl className="grid gap-4 sm:grid-cols-2">
        <Fact icon={MapPin} term={t("departure")}>
          <PlaceText place={trip.departure} exact={trip.exactLocation} isCampus={!toCampus} />
        </Fact>
        <Fact icon={MapPin} term={t("arrival")}>
          <PlaceText place={trip.destination} exact={trip.exactLocation} isCampus={toCampus} />
        </Fact>
        <Fact icon={CalendarClock} term={t("when")}>
          <time dateTime={trip.departureAt} className="font-semibold">
            {format.when(trip.departureAt, now)}
          </time>
        </Fact>
        <Fact icon={Users} term={t("seats")}>
          <span className="font-semibold" data-testid="trip-seats-left" data-seats-left={trip.seatsLeft}>
            {t("seatsValue", { left: trip.seatsLeft, total: trip.seats })}
          </span>
        </Fact>
        <Fact icon={Banknote} term={t("price")}>
          <span className="font-semibold">{format.pricePerSeat(trip.pricePerSeat)}</span>
        </Fact>
        <Fact icon={Route} term={t("distance")}>
          <span className="font-semibold">{t("distanceValue", { km: format.km(trip.distanceKm) })}</span>
        </Fact>
      </dl>

      {!trip.exactLocation && (
        <p className="flex items-start gap-2 rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t("approximate")}
        </p>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t("driver")}</h3>
        <p className="flex items-center gap-3">
          <Initials firstname={trip.driver.firstname} lastname={trip.driver.lastname} />
          <span className="min-w-0 text-sm">
            <span className="block font-medium" data-testid="trip-driver">
              {format.name(trip.driver)}
              {trip.myRole === "DRIVER" && <span className="text-muted-foreground"> ({tFormat("you")})</span>}
            </span>
            <RatingText rating={trip.driver} className="text-xs" />
          </span>
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t("preferences")}</h3>
        <PreferenceChips preferences={trip.preferences} />
      </div>

      {trip.notes && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t("notes")}</h3>
          <p className="whitespace-pre-wrap break-words text-sm" data-testid="trip-notes">
            {trip.notes}
          </p>
        </div>
      )}

      {trip.participants && trip.participants.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t("participants")}</h3>
          <ul className="space-y-2">
            {trip.participants.map((person) => (
              <li key={person.id} className="flex items-center gap-3 text-sm" data-participant-id={person.id} data-role={person.role}>
                <Initials firstname={person.firstname} lastname={person.lastname} className="h-8 w-8" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {format.name(person)}
                    {person.me && <span className="text-muted-foreground"> ({tFormat("you")})</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {person.role === "DRIVER" ? t("driverRole") : t("passengerRole", { count: person.seats ?? 1 })}
                  </span>
                </span>
                <RatingText rating={person} className="text-xs" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
