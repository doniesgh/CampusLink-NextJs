import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AnnouncementForm } from "@/components/announcements/announcement-form";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { manageHref, newHref } from "@/lib/announcements/paths";
import { loadAudienceOptions } from "@/lib/announcements/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("announcements.form");
  return { title: t("newTitle") };
}

/** /dashboard/admin/announcements/new: the composer (ADMIN: any audience, TEACHER: their groups). */
export default async function NewAnnouncementPage() {
  const [{ user, error }, t, tManage] = await Promise.all([
    requireRole(["ADMIN", "TEACHER"], newHref),
    getTranslations("announcements.form"),
    getTranslations("announcements.manage"),
  ]);

  if (!user) {
    const errors = await getErrorFormatter();
    return (
      <div className="container max-w-4xl space-y-6 py-6 sm:py-10">
        <PageHeader title={t("newTitle")} />
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  const { options, error: optionsError } = await loadAudienceOptions(user);

  return (
    <div className="container max-w-4xl space-y-6 py-6 sm:py-10">
      <Link
        href={manageHref}
        className="inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {tManage("backToList")}
      </Link>
      <PageHeader title={t("newTitle")} description={user.role === "ADMIN" ? t("newSubtitleAdmin") : t("newSubtitleTeacher")} />
      <AnnouncementForm options={options} optionsError={optionsError} />
    </div>
  );
}
