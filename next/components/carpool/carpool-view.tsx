"use client";

import { useMemo } from "react";
import { CalendarClock, CarFront, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MyTrips, type InitialMine } from "@/components/carpool/my-trips";
import { OfferForm } from "@/components/carpool/offer-form";
import { SearchPanel, type InitialSearch } from "@/components/carpool/search-panel";
import { setSearch, useLocationSearch, useNow } from "@/lib/timetable/client";
import { carpoolQuery, parseCarpoolParams, TABS, type CarpoolTab, type CarpoolUrlState } from "@/lib/carpool/paths";
import type { CarpoolSettings, Place, TripList } from "@/lib/carpool/types";

/** On phones the three tabs share the width: labels may wrap on two lines (French). */
const TRIGGER = "h-auto min-h-9 whitespace-normal rounded-xl px-2 text-center text-[0.8rem] leading-tight sm:whitespace-nowrap sm:rounded-full sm:px-4 sm:text-sm";

/**
 * /dashboard/carpool (STUDENT): tabs "Find a trip" / "Offer a trip" / "My trips". The state lives in the
 * address (History API, no server round trip); the server rendered the data of the address it received.
 */
export function CarpoolView({
  serverSearch,
  serverNow,
  places,
  settings,
  initialSearch,
  initialMine,
  initialDriverTrips,
}: {
  serverSearch: string;
  serverNow: number;
  places: readonly Place[];
  settings: CarpoolSettings;
  initialSearch: InitialSearch | null;
  initialMine: InitialMine | null;
  initialDriverTrips: { data: TripList | null; savedAt: number };
}) {
  const t = useTranslations("carpool.tabs");
  const search = useLocationSearch(serverSearch);
  const state = useMemo(() => parseCarpoolParams(new URLSearchParams(search), settings.defaultRadiusKm), [search, settings.defaultRadiusKm]);
  const now = useNow(serverNow);

  const setState = (patch: Partial<CarpoolUrlState>) => {
    setSearch(carpoolQuery({ ...state, ...patch }, settings.defaultRadiusKm), { replace: true });
  };
  const goTo = (tab: CarpoolTab) => {
    setSearch(carpoolQuery({ ...state, tab, page: 1 }, settings.defaultRadiusKm));
  };

  return (
    <Tabs value={state.tab} onValueChange={(value) => (TABS as readonly string[]).includes(value) && goTo(value as CarpoolTab)}>
      <TabsList aria-label={t("label")} className="grid w-full grid-cols-3 rounded-2xl sm:inline-flex sm:w-auto sm:rounded-full">
        <TabsTrigger value="search" className={TRIGGER}>
          <Search className="hidden h-4 w-4 sm:block" aria-hidden="true" />
          {t("search")}
        </TabsTrigger>
        <TabsTrigger value="offer" className={TRIGGER}>
          <CarFront className="hidden h-4 w-4 sm:block" aria-hidden="true" />
          {t("offer")}
        </TabsTrigger>
        <TabsTrigger value="mine" className={TRIGGER}>
          <CalendarClock className="hidden h-4 w-4 sm:block" aria-hidden="true" />
          {t("mine")}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="search">
        <SearchPanel
          state={state}
          setState={setState}
          places={places}
          settings={settings}
          initial={initialSearch}
          now={now}
        />
      </TabsContent>
      <TabsContent value="offer">
        <OfferForm places={places} settings={settings} now={now} initialDriverTrips={initialDriverTrips} />
      </TabsContent>
      <TabsContent value="mine">
        <MyTrips state={state} setState={setState} goTo={goTo} initial={initialMine} now={now} />
      </TabsContent>
    </Tabs>
  );
}
