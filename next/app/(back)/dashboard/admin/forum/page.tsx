import type { Metadata } from "next";
import { Hourglass } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/dal";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("forum");
  return { title: t("moderationMetaTitle") };
}

/** Placeholder created by the phase 2 foundation (docs/phase2-contract.md section 4): replaced by the forum module. */
export default async function ForumModerationPage() {
  await requireRole(["ADMIN"], "/dashboard/admin/forum");
  const t = await getTranslations("forum");
  return (
    <div className="container space-y-6 py-6 sm:py-10">
      <PageHeader title={t("moderationTitle")} description={t("moderationDescription")} />
      <EmptyState icon={Hourglass} title={t("comingSoon")} />
    </div>
  );
}
