import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MyProgressView } from "@/components/analytics/my-progress-view";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { ANALYTICS_HREF, myAnalyticsPath } from "@/lib/analytics/paths";
import { isStudentAnalytics, type StudentAnalytics } from "@/lib/analytics/types";
import { requireRole } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverSnapshot } from "@/lib/server-api";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("analytics");
  return { title: t("metaTitle") };
}

/**
 * "My progress" (STUDENT, docs/phase2-contract.md section 4): attendance per subject with alert levels, grades and
 * averages, progress and activity charts, opt-in group comparison, PDF report. The data is rendered on the server
 * (no API request from the browser on load) and kept on the device for offline reading.
 */
export default async function AnalyticsPage() {
  const [{ user, error }, t] = await Promise.all([requireRole(["STUDENT"], ANALYTICS_HREF), getTranslations("analytics")]);

  if (!user) {
    const errors = await getErrorFormatter();
    return (
      <div className="container space-y-6 py-6 sm:py-10">
        <PageHeader title={t("title")} />
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  const snapshot = await serverSnapshot<StudentAnalytics | null>(myAnalyticsPath(), null);
  const data = isStudentAnalytics(snapshot.data) ? snapshot.data : null;

  return (
    <div className="container py-6 sm:py-10">
      <MyProgressView initial={{ data, savedAt: snapshot.savedAt }} />
    </div>
  );
}
