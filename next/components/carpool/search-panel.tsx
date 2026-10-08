"use client";

import { useState } from "react";
import { CarFront, RefreshCw, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SkeletonList } from "@/components/ui/skeleton";
import { MY_LOCATION, PlacePicker } from "@/components/carpool/place-picker";
import { TripCard } from "@/components/carpool/trip-card";
import { useCarpoolFormat } from "@/components/carpool/use-carpool-format";
import { useGeolocation } from "@/components/carpool/use-geolocation";
import { useHydrated } from "@/components/carpool/use-hydrated";
import { addDays, dateKey, type DateKey } from "@/lib/datetime";
import { useErrorFormatter } from "@/lib/i18n/client";
import { useOfflineQuery, useOnlineStatus } from "@/lib/offline";
import { coarse } from "@/lib/carpool/geo";
import { PAGE_SIZE, RADIUS_OPTIONS, REQUEST_SEAT_OPTIONS, searchQuery, type CarpoolUrlState, type SearchPoint } from "@/lib/carpool/paths";
import { DIRECTIONS, type CarpoolSettings, type Direction, type Place, type TripList } from "@/lib/carpool/types";

export type InitialSearch = { data: TripList | null; savedAt: number };

/**
 * "Find a trip": area (curated place or "Use my location"), radius, date, direction and seats; results sorted
 * by distance then time (or by time without an area). Filters live in the address (`setState`), except the
 * device's position, which stays in memory.
 */
export function SearchPanel({
  state,
  setState,
  places,
  settings,
  initial,
  now,
}: {
  state: CarpoolUrlState;
  setState: (patch: Partial<CarpoolUrlState>) => void;
  places: readonly Place[];
  settings: CarpoolSettings;
  initial: InitialSearch | null;
  now: number;
}) {
  const t = useTranslations("carpool.search");
  const tDirections = useTranslations("carpool.directions");
  const tCommon = useTranslations("common.actions");
  const errors = useErrorFormatter();
  const format = useCarpoolFormat();
  const online = useOnlineStatus();
  const geolocation = useGeolocation();
  const [useMine, setUseMine] = useState(false);
  const hydrated = useHydrated();

  const geo = geolocation.state;
  const place = state.place ? (places.find((item) => item.id === state.place) ?? null) : null;
  const point: SearchPoint | null =
    useMine && geo.status === "located"
      ? { kind: "geo", point: coarse(geo.point), accuracy: geo.accuracy }
      : place
        ? { kind: "place", place }
        : null;
  const query = searchQuery({ point, radius: state.radius, date: state.date, direction: state.direction, seats: state.seats, page: state.page });
  const { data, isLoading, isValidating, error, refresh, fromCache, savedAt } = useOfflineQuery<TripList>(query.key, query.path, {
    fallbackData: initial?.data ?? undefined,
    fallbackSavedAt: initial?.savedAt,
    revalidateOnMount: !initial?.data,
  });
  const items = Array.isArray(data?.items) ? data.items : [];
  const total = typeof data?.total === "number" ? data.total : 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pickerValue = useMine && geo.status === "located" ? MY_LOCATION : (state.place ?? "");
  const nearLabel = point ? (point.kind === "geo" ? ({ kind: "you" } as const) : ({ kind: "place", label: point.place.label } as const)) : null;
  const today = dateKey(now);
  const showSavedCopy = (fromCache || (!online && data)) && savedAt;

  const onPlace = (value: string) => {
    if (value === MY_LOCATION) {
      setUseMine(true);
      setState({ place: null, page: 1 });
      return;
    }
    setUseMine(false);
    setState({ place: value || null, page: 1 });
  };

  const onLocate = () => {
    setUseMine(true);
    geolocation.locate();
  };

  return (
    <div className="space-y-6">
      <form
        role="search"
        aria-label={t("formLabel")}
        data-ready={hydrated ? "true" : undefined}
        className="grid grid-cols-2 gap-4 rounded-3xl border bg-card p-4 text-card-foreground sm:p-6 lg:grid-cols-12"
        onSubmit={(event) => {
          event.preventDefault();
          void refresh();
        }}
      >
        <div className="col-span-2 lg:col-span-12">
          <PlacePicker
            id="carpool-search-area"
            label={t("area")}
            hint={t("areaHint")}
            places={places}
            value={pickerValue}
            onChange={onPlace}
            geo={geo}
            onLocate={onLocate}
            emptyLabel={t("anywhere")}
          />
        </div>
        <div className="min-w-0 space-y-2 lg:col-span-3">
          <Label htmlFor="carpool-search-radius">{t("radius")}</Label>
          <Select
            id="carpool-search-radius"
            value={String(state.radius)}
            onChange={(event) => setState({ radius: Number(event.target.value), page: 1 })}
            disabled={!point}
            aria-describedby={point ? undefined : "carpool-search-radius-hint"}
          >
            {RADIUS_OPTIONS.filter((km) => km <= settings.maxRadiusKm).map((km) => (
              <option key={km} value={km}>
                {t("radiusValue", { km })}
              </option>
            ))}
          </Select>
          {!point && (
            <p id="carpool-search-radius-hint" className="text-xs text-muted-foreground">
              {t("radiusHint")}
            </p>
          )}
        </div>
        <div className="min-w-0 space-y-2 lg:col-span-3">
          <Label htmlFor="carpool-search-seats">{t("seats")}</Label>
          <Select id="carpool-search-seats" value={String(state.seats)} onChange={(event) => setState({ seats: Number(event.target.value), page: 1 })}>
            {REQUEST_SEAT_OPTIONS.map((seats) => (
              <option key={seats} value={seats}>
                {seats}
              </option>
            ))}
          </Select>
        </div>
        <div className="col-span-2 min-w-0 space-y-2 lg:col-span-3">
          <Label htmlFor="carpool-search-date">{t("date")}</Label>
          <Input
            id="carpool-search-date"
            type="date"
            value={state.date ?? ""}
            min={today}
            max={addDays(today, settings.maxDaysAhead)}
            onChange={(event) => setState({ date: (event.target.value as DateKey) || null, page: 1 })}
            aria-describedby="carpool-search-date-hint"
          />
          <p id="carpool-search-date-hint" className="text-xs text-muted-foreground">
            {t("dateHint")}
          </p>
        </div>
        <div className="col-span-2 min-w-0 space-y-2 lg:col-span-3">
          <Label htmlFor="carpool-search-direction">{t("direction")}</Label>
          <Select
            id="carpool-search-direction"
            value={state.direction ?? ""}
            onChange={(event) => setState({ direction: (event.target.value as Direction) || null, page: 1 })}
          >
            <option value="">{t("bothDirections")}</option>
            {DIRECTIONS.map((direction) => (
              <option key={direction} value={direction}>
                {tDirections(direction)}
              </option>
            ))}
          </Select>
        </div>
        <div className="col-span-2 flex flex-wrap items-center gap-2 lg:col-span-12">
          <Button type="submit" disabled={!online || isValidating} aria-busy={isValidating || undefined}>
            <Search className="h-4 w-4" aria-hidden="true" />
            {t("submit")}
          </Button>
          {(state.place || useMine || state.date || state.direction || state.seats > 1 || state.radius !== settings.defaultRadiusKm) && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setUseMine(false);
                geolocation.reset();
                setState({ place: null, date: null, direction: null, seats: 1, radius: settings.defaultRadiusKm, page: 1 });
              }}
            >
              {tCommon("resetFilters")}
            </Button>
          )}
        </div>
      </form>

      <section aria-labelledby="carpool-results-title" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="carpool-results-title" className="text-lg font-semibold">
            {t("resultsTitle")}
          </h2>
          {data && (
            <p className="text-sm text-muted-foreground" aria-live="polite" data-testid="carpool-count">
              {point ? t("countNear", { count: total, km: state.radius }) : t("count", { count: total })}
            </p>
          )}
        </div>
        {showSavedCopy && <p className="text-sm text-muted-foreground">{t("savedCopy", { time: format.dateTime(new Date(savedAt).toISOString()) })}</p>}

        {isLoading && <SkeletonList rows={3} label={t("loading")} />}
        {!isLoading && !data && error && (
          <InlineFeedback feedback={{ type: "error", message: error.isNetworkError ? t("offline") : errors.message(error) }}>
            <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={!online}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              {tCommon("tryAgain")}
            </Button>
          </InlineFeedback>
        )}
        {data && items.length === 0 && (
          <EmptyState icon={CarFront} title={t("emptyTitle")} description={t("emptyText")} headingLevel="h3" />
        )}
        {items.length > 0 && (
          <ul className="grid gap-3 md:grid-cols-2" aria-labelledby="carpool-results-title">
            {items.map((trip) => (
              <li key={trip.id}>
                <TripCard trip={trip} now={now} nearLabel={nearLabel} />
              </li>
            ))}
          </ul>
        )}
        {pages > 1 && (
          <nav aria-label={t("pagination")} className="flex items-center justify-between gap-2">
            <Button type="button" variant="outline" size="sm" disabled={state.page <= 1} onClick={() => setState({ page: state.page - 1 })}>
              {tCommon("previous")}
            </Button>
            <p className="text-sm text-muted-foreground">{t("page", { page: state.page, pages })}</p>
            <Button type="button" variant="outline" size="sm" disabled={state.page >= pages} onClick={() => setState({ page: state.page + 1 })}>
              {tCommon("next")}
            </Button>
          </nav>
        )}
      </section>
    </div>
  );
}
