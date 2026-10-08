import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CarpoolView } from "@/components/carpool/carpool-view";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverApiOr, serverSnapshot } from "@/lib/server-api";
import { carpoolQuery, myTripsQuery, parseCarpoolParams, placesPath, searchQuery, settingsPath } from "@/lib/carpool/paths";
import { DEFAULT_SETTINGS, isPlaceList, isSettings, isTripList, type CarpoolSettings, type Place, type TripList } from "@/lib/carpool/types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("carpool");
  return { title: t("metaTitle") };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const listOrNull = (data: unknown): TripList | null => (isTripList(data) ? data : null);

/**
 * Carpooling (Module 2) for students (other roles are sent to /dashboard). The server renders the places, the
 * settings, the data of the tab in the address and the driver's upcoming trips (offer form limit), so the page
 * makes no API request from the browser when it loads (the real-time connection only opens on trip pages and
 * in "My trips").
 */
export default async function CarpoolPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const [{ user, error }, t, params] = await Promise.all([requireRole(["STUDENT"]), getTranslations("carpool"), searchParams]);

  if (!user) {
    const errors = await getErrorFormatter();
    return (
      <div className="container space-y-6 py-6 sm:py-10">
        <PageHeader title={t("title")} />
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  const [placesData, settingsData, driverTrips] = await Promise.all([
    serverApiOr<unknown>(placesPath, []),
    serverApiOr<unknown>(settingsPath, null),
    serverSnapshot<unknown>(myTripsQuery("driver", "upcoming", 1, 50).path, null),
  ]);
  const places: Place[] = isPlaceList(placesData) ? placesData : [];
  const settings: CarpoolSettings = isSettings(settingsData) ? { ...DEFAULT_SETTINGS, ...settingsData } : DEFAULT_SETTINGS;
  const state = parseCarpoolParams(params, settings.defaultRadiusKm);

  let initialSearch: { data: TripList | null; savedAt: number } | null = null;
  let initialMine: { data: TripList | null; savedAt: number } | null = null;
  if (state.tab === "search") {
    const place = state.place ? (places.find((item) => item.id === state.place) ?? null) : null;
    const query = searchQuery({
      point: place ? { kind: "place", place } : null,
      radius: state.radius,
      date: state.date,
      direction: state.direction,
      seats: state.seats,
      page: state.page,
    });
    const snapshot = await serverSnapshot<unknown>(query.path, null);
    initialSearch = { data: listOrNull(snapshot.data), savedAt: snapshot.savedAt };
  } else if (state.tab === "mine") {
    const snapshot = await serverSnapshot<unknown>(myTripsQuery(state.role, state.scope, state.page).path, null);
    initialMine = { data: listOrNull(snapshot.data), savedAt: snapshot.savedAt };
  }

  return (
    <div className="container space-y-6 py-6 sm:py-10">
      <PageHeader title={t("title")} description={t("description")} />
      <CarpoolView
        serverSearch={carpoolQuery(state, settings.defaultRadiusKm)}
        serverNow={driverTrips.savedAt}
        places={places}
        settings={settings}
        initialSearch={initialSearch}
        initialMine={initialMine}
        initialDriverTrips={{ data: listOrNull(driverTrips.data), savedAt: driverTrips.savedAt }}
      />
    </div>
  );
}
