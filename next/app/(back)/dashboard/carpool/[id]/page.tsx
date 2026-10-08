import { cache } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TripNotFound } from "@/components/carpool/trip-not-found";
import { TripView } from "@/components/carpool/trip-view";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { toApiError, type ApiError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverApi, serverSnapshot } from "@/lib/server-api";
import { messagesPath, tripPath } from "@/lib/carpool/paths";
import { isMessagePage, isObjectId, isParticipant, isTripDetail, type MessagePage, type TripDetail } from "@/lib/carpool/types";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Loaded = { data: TripDetail; savedAt: number; error?: undefined } | { data?: undefined; savedAt: number; error: ApiError };

// One backend call per request, shared by generateMetadata and the page.
const loadTrip = cache(async (id: string): Promise<Loaded> => {
  try {
    const data = await serverApi<TripDetail>(tripPath(id));
    if (!isTripDetail(data)) return { error: toApiError(new Error("Unexpected answer")), savedAt: Date.now() };
    return { data, savedAt: Date.now() };
  } catch (e) {
    return { error: toApiError(e), savedAt: Date.now() };
  }
});

const isMissing = (error: ApiError) => error.status === 404 || error.status === 400;

export async function generateMetadata({ params }: Readonly<{ params: Params }>): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("carpool");
  if (!isObjectId(id)) return { title: t("tripMetaTitle") };
  const loaded = await loadTrip(id);
  return {
    title: loaded.data ? t("format.routeTitle", { from: loaded.data.departure.label, to: loaded.data.destination.label }) : t("tripMetaTitle"),
  };
}

/**
 * A trip (Module 2) for students: details, seat request / requests management, real-time chat for the driver
 * and the accepted passengers, cancellation and ratings. Rendered on the server (trip + latest messages for
 * participants), then kept up to date by the offline data layer and the real-time layer.
 */
export default async function CarpoolTripPage({ params, searchParams }: Readonly<{ params: Params; searchParams: SearchParams }>) {
  const [{ id }, query, { user, error }, t] = await Promise.all([params, searchParams, requireRole(["STUDENT"]), getTranslations("carpool")]);

  if (!user) {
    const errors = await getErrorFormatter();
    return (
      <div className="container space-y-6 py-6 sm:py-10">
        <PageHeader title={t("tripMetaTitle")} />
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  const loaded = isObjectId(id) ? await loadTrip(id) : null;
  if (!loaded || (loaded.error && isMissing(loaded.error))) {
    return (
      <div className="container py-6 sm:py-10">
        <TripNotFound title={t("trip.notFoundTitle")} description={t("trip.notFoundText")} backLabel={t("trip.back")} />
      </div>
    );
  }

  let initialMessages: { data: MessagePage; savedAt: number } | null = null;
  if (loaded.data && isParticipant(loaded.data)) {
    const snapshot = await serverSnapshot<unknown>(messagesPath(id), null);
    if (isMessagePage(snapshot.data)) initialMessages = { data: snapshot.data, savedAt: snapshot.savedAt };
  }

  // Backend unreachable: the browser shows the copy saved on this device, if any.
  return (
    <div className="container py-6 sm:py-10">
      <TripView
        id={id}
        viewerId={user.id}
        initial={loaded.data ? { data: loaded.data, savedAt: loaded.savedAt } : null}
        initialMessages={initialMessages}
        serverNow={loaded.savedAt}
        created={query.done === "created"}
      />
    </div>
  );
}
