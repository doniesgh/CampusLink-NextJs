import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AnnouncementNotFound } from "@/components/announcements/not-found-state";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverApiOr } from "@/lib/server-api";
import { manageHref, statsHref } from "@/lib/announcements/paths";
import { isMissingError, loadManagedAnnouncement } from "@/lib/announcements/server";
import { isObjectId, type AnnouncementDetailedStats } from "@/lib/announcements/types";
import { StatsView } from "./stats-view";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: Readonly<{ params: Params }>): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("announcements.stats");
  if (!isObjectId(id)) return { title: t("metaTitle") };
  const loaded = await loadManagedAnnouncement(id);
  return { title: loaded.data ? t("metaTitleWith", { title: loaded.data.title }) : t("metaTitle") };
}

/** /dashboard/admin/announcements/[id]: statistics ("Read rate", reads by day), audience, message, actions. */
export default async function AnnouncementStatsPage({ params }: Readonly<{ params: Params }>) {
  const { id } = await params;
  const [{ user, error }, t] = await Promise.all([requireRole(["ADMIN", "TEACHER"], statsHref(id)), getTranslations("announcements")]);
  const errors = await getErrorFormatter();

  if (!user) {
    return (
      <div className="container space-y-6 py-6 sm:py-10">
        <PageHeader title={t("stats.metaTitle")} />
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  const notFound = (
    <div className="container max-w-4xl py-6 sm:py-10">
      <AnnouncementNotFound backHref={manageHref} backLabel={t("manage.backToList")} />
    </div>
  );
  if (!isObjectId(id)) return notFound;

  const [loaded, stats] = await Promise.all([
    loadManagedAnnouncement(id),
    serverApiOr<AnnouncementDetailedStats | null>(`/announcements/${encodeURIComponent(id)}/stats`, null),
  ]);
  // Only the author and admins get `stats`: anyone else sees "not found".
  if ((loaded.error && isMissingError(loaded.error)) || (loaded.data && !loaded.data.stats)) return notFound;
  if (!loaded.data) {
    return (
      <div className="container space-y-6 py-6 sm:py-10">
        <PageHeader title={t("stats.metaTitle")} />
        <InlineFeedback feedback={{ type: "error", message: errors.message(loaded.error) }} />
      </div>
    );
  }

  return (
    <div className="container max-w-4xl py-6 sm:py-10">
      <StatsView announcement={loaded.data} stats={stats && Array.isArray(stats.readsByDay) ? stats : null} />
    </div>
  );
}
