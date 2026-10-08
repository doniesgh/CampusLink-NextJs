import type { Metadata } from "next";
import { Hourglass } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/dal";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketplace");
  return { title: t("metaTitle") };
}

/** Placeholder created by the phase 3 foundation (docs/phase3-contract.md section 5): replaced by the marketplace module. */
export default async function MarketplacePage() {
  await requireRole(["STUDENT", "TEACHER", "ADMIN"], "/dashboard/marketplace");
  const t = await getTranslations("marketplace");
  return (
    <div className="container space-y-6 py-6 sm:py-10">
      <PageHeader title={t("title")} description={t("description")} />
      <EmptyState icon={Hourglass} title={t("comingSoon")} />
    </div>
  );
}
