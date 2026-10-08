import type { Metadata } from "next";
import { Hourglass } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/dal";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("analytics");
  return { title: t("attendanceMetaTitle") };
}

/** Placeholder created by the phase 2 foundation (docs/phase2-contract.md section 4): replaced by the analytics module. */
export default async function AttendancePage() {
  await requireRole(["TEACHER", "ADMIN"], "/dashboard/attendance");
  const t = await getTranslations("analytics");
  return (
    <div className="container space-y-6 py-6 sm:py-10">
      <PageHeader title={t("attendanceTitle")} description={t("attendanceDescription")} />
      <EmptyState icon={Hourglass} title={t("comingSoon")} />
    </div>
  );
}
