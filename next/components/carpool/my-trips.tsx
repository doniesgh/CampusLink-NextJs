"use client";

import { CalendarClock, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback } from "@/components/ui/feedback";
import { SkeletonList } from "@/components/ui/skeleton";
import { TripCard } from "@/components/carpool/trip-card";
import { useCarpoolFormat } from "@/components/carpool/use-carpool-format";
import { useHydrated } from "@/components/carpool/use-hydrated";
import { useErrorFormatter } from "@/lib/i18n/client";
import { invalidateQueries, useOfflineQuery, useOnlineStatus } from "@/lib/offline";
import { useRealtimeEvent } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { myTripsQuery, PAGE_SIZE, type CarpoolTab, type CarpoolUrlState, type MineRole, type MineScope } from "@/lib/carpool/paths";
import type { TripList } from "@/lib/carpool/types";

export type InitialMine = { data: TripList | null; savedAt: number };

function Toggle<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full bg-muted p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === option.value && "bg-background text-foreground shadow-sm"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * "My trips": as driver or passenger, upcoming or past (a trip is past one hour after its departure). Every
 * status is listed (cancelled trips too); the list refreshes live when a request changes.
 */
export function MyTrips({
  state,
  setState,
  goTo,
  initial,
  now,
}: {
  state: CarpoolUrlState;
  setState: (patch: Partial<CarpoolUrlState>) => void;
  goTo: (tab: CarpoolTab) => void;
  initial: InitialMine | null;
  now: number;
}) {
  const t = useTranslations("carpool.mine");
  const tCommon = useTranslations("common.actions");
  const tSearch = useTranslations("carpool.search");
  const errors = useErrorFormatter();
  const format = useCarpoolFormat();
  const online = useOnlineStatus();
  const hydrated = useHydrated();
  const query = myTripsQuery(state.role, state.scope, state.page);
  const { data, isLoading, error, refresh, fromCache, savedAt } = useOfflineQuery<TripList>(query.key, query.path, {
    fallbackData: initial?.data ?? undefined,
    fallbackSavedAt: initial?.savedAt,
    revalidateOnMount: !initial?.data,
  });

  // A request was sent, answered or cancelled: the lists of "My trips" may change.
  useRealtimeEvent("carpool:request", () => invalidateQueries("carpool:mine"));

  const items = Array.isArray(data?.items) ? data.items : [];
  const total = typeof data?.total === "number" ? data.total : 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const emptyKey =
    state.role === "driver"
      ? state.scope === "upcoming"
        ? "emptyDriverUpcoming"
        : "emptyDriverPast"
      : state.scope === "upcoming"
        ? "emptyPassengerUpcoming"
        : "emptyPassengerPast";

  return (
    <section aria-labelledby="carpool-mine-title" className="space-y-4" data-ready={hydrated ? "true" : undefined}>
      <h2 id="carpool-mine-title" className="sr-only">
        {t("title")}
      </h2>
      <div className="flex flex-wrap gap-2">
        <Toggle<MineRole>
          label={t("roleLabel")}
          value={state.role}
          onChange={(role) => setState({ role, page: 1 })}
          options={[
            { value: "driver", label: t("asDriver") },
            { value: "passenger", label: t("asPassenger") },
          ]}
        />
        <Toggle<MineScope>
          label={t("scopeLabel")}
          value={state.scope}
          onChange={(scope) => setState({ scope, page: 1 })}
          options={[
            { value: "upcoming", label: t("upcoming") },
            { value: "past", label: t("past") },
          ]}
        />
      </div>

      {(fromCache || !online) && data && savedAt && (
        <p className="text-sm text-muted-foreground">{tSearch("savedCopy", { time: format.dateTime(new Date(savedAt).toISOString()) })}</p>
      )}
      {isLoading && <SkeletonList rows={3} label={t("loading")} />}
      {!isLoading && !data && error && (
        <InlineFeedback feedback={{ type: "error", message: error.isNetworkError ? tSearch("offline") : errors.message(error) }}>
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={!online}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {tCommon("tryAgain")}
          </Button>
        </InlineFeedback>
      )}
      {data && items.length === 0 && (
        <EmptyState
          icon={CalendarClock}
          title={t(emptyKey)}
          headingLevel="h3"
          action={
            state.role === "driver" ? (
              <Button type="button" variant="outline" onClick={() => goTo("offer")}>
                {t("offerCta")}
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={() => goTo("search")}>
                {t("findCta")}
              </Button>
            )
          }
        />
      )}
      {items.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2" aria-labelledby="carpool-mine-title">
          {items.map((trip) => (
            <li key={trip.id}>
              <TripCard trip={trip} now={now} />
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <nav aria-label={tSearch("pagination")} className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" size="sm" disabled={state.page <= 1} onClick={() => setState({ page: state.page - 1 })}>
            {tCommon("previous")}
          </Button>
          <p className="text-sm text-muted-foreground">{tSearch("page", { page: state.page, pages })}</p>
          <Button type="button" variant="outline" size="sm" disabled={state.page >= pages} onClick={() => setState({ page: state.page + 1 })}>
            {tCommon("next")}
          </Button>
        </nav>
      )}
    </section>
  );
}
