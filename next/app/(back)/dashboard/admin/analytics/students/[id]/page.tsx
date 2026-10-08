import { cache } from "react";
import type { Metadata } from "next";
import { UserX } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { StaffStudentView } from "@/components/analytics/staff-student-view";
import Link from "@/components/ui/app-link";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { toApiError, type ApiError } from "@/lib/api";
import { FOLLOW_UP_HREF, studentAnalyticsPath, studentFollowUpHref } from "@/lib/analytics/paths";
import { isObjectId, isStudentAnalytics, personName, type StudentAnalytics } from "@/lib/analytics/types";
import { requireRole } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverApi } from "@/lib/server-api";
import { cn } from "@/lib/utils";

type Params = Promise<{ id: string }>;
type Loaded = { data: StudentAnalytics; error?: undefined } | { data?: undefined; error: ApiError };

// One backend call per request, shared by generateMetadata and the page.
const loadStudent = cache(async (id: string): Promise<Loaded> => {
  try {
    const data = await serverApi<StudentAnalytics>(studentAnalyticsPath(id));
    if (!isStudentAnalytics(data)) return { error: toApiError(new Error("Unexpected answer")) };
    return { data };
  } catch (e) {
    return { error: toApiError(e) };
  }
});

export async function generateMetadata({ params }: Readonly<{ params: Params }>): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("analytics");
  if (!isObjectId(id)) return { title: t("followUpMetaTitle") };
  const loaded = await loadStudent(id);
  return { title: loaded.data ? t("followUp.student.metaTitle", { name: personName(loaded.data.student) }) : t("followUpMetaTitle") };
}

/** One student's follow-up (ADMIN): attendance, grades, charts, comparison and the PDF report. */
export default async function StudentFollowUpDetailPage({ params }: Readonly<{ params: Params }>) {
  const { id } = await params;
  const [{ user, error }, t, tRoot] = await Promise.all([
    requireRole(["ADMIN"], isObjectId(id) ? studentFollowUpHref(id) : FOLLOW_UP_HREF),
    getTranslations("analytics.followUp.student"),
    getTranslations("analytics"),
  ]);
  const errors = await getErrorFormatter();

  if (!user) {
    return (
      <div className="container space-y-6 py-6 sm:py-10">
        <PageHeader title={tRoot("followUpTitle")} />
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  const loaded = isObjectId(id) ? await loadStudent(id) : null;
  if (!loaded?.data) {
    const missing = !loaded || [400, 404].includes(loaded.error.status);
    return (
      <div className="container space-y-6 py-6 sm:py-10">
        <PageHeader title={tRoot("followUpTitle")} />
        <EmptyState
          icon={UserX}
          title={missing ? t("notFound") : errors.message(loaded.error)}
          action={
            <Link href={FOLLOW_UP_HREF} className={cn(buttonVariants({ variant: "outline" }), "rounded-full")}>
              {t("back")}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="container py-6 sm:py-10">
      <StaffStudentView data={loaded.data} />
    </div>
  );
}
