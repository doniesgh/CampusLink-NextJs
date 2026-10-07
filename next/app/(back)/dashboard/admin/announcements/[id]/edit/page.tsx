import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AnnouncementForm } from "@/components/announcements/announcement-form";
import { StatusBadge } from "@/components/announcements/badges";
import { AnnouncementNotFound } from "@/components/announcements/not-found-state";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { editHref, manageHref, statsHref } from "@/lib/announcements/paths";
import { isMissingError, loadAudienceOptions, loadManagedAnnouncement } from "@/lib/announcements/server";
import { isObjectId } from "@/lib/announcements/types";

type Params = Promise<{ id: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("announcements.form");
  return { title: t("editTitle") };
}

/** /dashboard/admin/announcements/[id]/edit: same composer; a published announcement only edits title, message, priority. */
export default async function EditAnnouncementPage({ params }: Readonly<{ params: Params }>) {
  const { id } = await params;
  const [{ user, error }, t, tManage] = await Promise.all([
    requireRole(["ADMIN", "TEACHER"], editHref(id)),
    getTranslations("announcements.form"),
    getTranslations("announcements.manage"),
  ]);
  const errors = await getErrorFormatter();

  if (!user) {
    return (
      <div className="container max-w-4xl space-y-6 py-6 sm:py-10">
        <PageHeader title={t("editTitle")} />
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  const notFound = (
    <div className="container max-w-4xl py-6 sm:py-10">
      <AnnouncementNotFound backHref={manageHref} backLabel={tManage("backToList")} />
    </div>
  );
  if (!isObjectId(id)) return notFound;

  const [loaded, audience] = await Promise.all([loadManagedAnnouncement(id), loadAudienceOptions(user)]);
  if ((loaded.error && isMissingError(loaded.error)) || (loaded.data && !loaded.data.stats)) return notFound;
  if (!loaded.data) {
    return (
      <div className="container max-w-4xl space-y-6 py-6 sm:py-10">
        <PageHeader title={t("editTitle")} />
        <InlineFeedback feedback={{ type: "error", message: errors.message(loaded.error) }} />
      </div>
    );
  }

  const announcement = loaded.data;
  return (
    <div className="container max-w-4xl space-y-6 py-6 sm:py-10">
      <Link
        href={statsHref(announcement.id)}
        className="inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {tManage("backToAnnouncement")}
      </Link>
      <PageHeader
        title={t("editTitle")}
        description={announcement.status === "PUBLISHED" ? t("editPublishedSubtitle") : t("editSubtitle")}
        actions={<StatusBadge status={announcement.status} />}
      />
      <AnnouncementForm announcement={announcement} options={audience.options} optionsError={audience.error} />
    </div>
  );
}
