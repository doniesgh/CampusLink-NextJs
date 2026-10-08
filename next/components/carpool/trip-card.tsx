"use client";

import { ArrowRight, MapPin, Route, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "@/components/ui/app-link";
import { DirectionBadge, RatingText, RequestStatusBadge, TripStatusBadge } from "@/components/carpool/badges";
import { useCarpoolFormat } from "@/components/carpool/use-carpool-format";
import { cn } from "@/lib/utils";
import { tripHref } from "@/lib/carpool/paths";
import type { Trip } from "@/lib/carpool/types";

/** "Ariana → ESPRIT Ghazela" (read "Ariana to ESPRIT Ghazela"). */
export function RouteText({ from, to, className }: { from: string; to: string; className?: string }) {
  const t = useTranslations("carpool.format");
  return (
    <span className={cn("inline-flex min-w-0 flex-wrap items-center gap-x-1.5", className)}>
      <span className="break-words">{from}</span>
      <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="sr-only"> {t("to")} </span>
      <span className="break-words">{to}</span>
    </span>
  );
}

/** Initials in a round avatar (no photos in the API). */
export function Initials({ firstname, lastname, className }: { firstname?: string; lastname?: string; className?: string }) {
  const initials = `${firstname?.[0] ?? ""}${lastname?.[0] ?? ""}`.toUpperCase() || "?";
  return (
    <span
      aria-hidden="true"
      className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground", className)}
    >
      {initials}
    </span>
  );
}

/**
 * A trip in the search results and in "My trips": `article[data-trip-id][data-status]`, whose route links to
 * the trip page (the whole card is clickable). `nearLabel` names the search point ("you" or a place).
 */
export function TripCard({ trip, now, nearLabel }: { trip: Trip; now: number; nearLabel?: { kind: "you" } | { kind: "place"; label: string } | null }) {
  const t = useTranslations("carpool");
  const format = useCarpoolFormat();
  const distance = typeof trip.distanceFromYouKm === "number" && nearLabel ? trip.distanceFromYouKm : null;
  const showRequest = trip.myRequest && trip.myRole !== "DRIVER";

  return (
    <article
      data-trip-id={trip.id}
      data-status={trip.status}
      data-direction={trip.direction}
      className="relative rounded-3xl border bg-card p-4 text-card-foreground transition-colors focus-within:ring-2 focus-within:ring-ring hover:border-primary/40 sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-primary">
            <time dateTime={trip.departureAt}>{format.when(trip.departureAt, now)}</time>
          </p>
          <h3 className="mt-1 text-base font-semibold leading-snug">
            <Link
              href={tripHref(trip.id)}
              className="rounded-md after:absolute after:inset-0 after:rounded-3xl focus-visible:outline-none"
            >
              <RouteText from={trip.departure.label} to={trip.destination.label} />
            </Link>
          </h3>
        </div>
        <p className="shrink-0 text-right">
          <span className="block text-lg font-bold leading-tight" data-testid="trip-price">
            {format.price(trip.pricePerSeat)}
          </span>
          {trip.pricePerSeat > 0 && <span className="block text-xs text-muted-foreground">{t("format.perSeat")}</span>}
        </p>
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {distance !== null && nearLabel && (
          <li className="inline-flex items-center gap-1.5 font-medium text-foreground" data-testid="trip-distance-from">
            <MapPin className="h-4 w-4" aria-hidden="true" />
            {nearLabel.kind === "you"
              ? t("format.fromYou", { km: format.km(distance) })
              : t("format.fromPlace", { km: format.km(distance), place: nearLabel.label })}
          </li>
        )}
        <li className="inline-flex items-center gap-1.5" data-testid="trip-seats">
          <Users className="h-4 w-4" aria-hidden="true" />
          {trip.status === "FULL" ? t("statuses.FULL") : t("format.seatsLeft", { count: trip.seatsLeft })}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <Route className="h-4 w-4" aria-hidden="true" />
          {t("format.distance", { km: format.km(trip.distanceKm) })}
        </li>
      </ul>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <p className="flex min-w-0 items-center gap-2 text-sm">
          <Initials firstname={trip.driver.firstname} lastname={trip.driver.lastname} className="h-8 w-8" />
          <span className="min-w-0">
            <span className="block truncate font-medium">
              {trip.myRole === "DRIVER" ? t("card.youDrive") : format.name(trip.driver)}
            </span>
            <RatingText rating={trip.driver} className="text-xs" />
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <DirectionBadge direction={trip.direction} />
          {trip.status !== "OPEN" && <TripStatusBadge status={trip.status} />}
          {showRequest && trip.myRequest && <RequestStatusBadge status={trip.myRequest.status} />}
        </div>
      </div>
    </article>
  );
}
