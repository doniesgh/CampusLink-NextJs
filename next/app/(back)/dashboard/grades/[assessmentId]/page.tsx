import { cache } from "react";
import type { Metadata } from "next";
import { ClipboardX } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { GradeSheetEditor } from "@/components/analytics/grade-sheet-editor";
import Link from "@/components/ui/app-link";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { toApiError, type ApiError } from "@/lib/api";
import { GRADES_HREF, gradeSheetHref } from "@/lib/analytics/paths";
import { isGradeSheet, isObjectId, type GradeSheet } from "@/lib/analytics/types";
import { requireRole } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverApi } from "@/lib/server-api";
import { cn } from "@/lib/utils";
import { publishAssessmentAction, saveGradesAction } from "../actions";

type Params = Promise<{ assessmentId: string }>;
type Loaded = { data: GradeSheet; error?: undefined } | { data?: undefined; error: ApiError };

// One backend call per request, shared by generateMetadata and the page.
const loadSheet = cache(async (id: string): Promise<Loaded> => {
  try {
    const data = await serverApi<GradeSheet>(`/grades/assessments/${encodeURIComponent(id)}/grades`);
    if (!isGradeSheet(data)) return { error: toApiError(new Error("Unexpected answer")) };
    return { data };
  } catch (e) {
    return { error: toApiError(e) };
  }
});

export async function generateMetadata({ params }: Readonly<{ params: Params }>): Promise<Metadata> {
  const { assessmentId } = await params;
  const t = await getTranslations("analytics");
  if (!isObjectId(assessmentId)) return { title: t("gradesMetaTitle") };
  const loaded = await loadSheet(assessmentId);
  const title = loaded.data?.assessment.title;
  return { title: title ? t("grades.sheet.metaTitle", { title }) : t("gradesMetaTitle") };
}

/** Grade entry of one assessment (a teacher of that subject and group this year, or ADMIN). */
export default async function GradeSheetPage({ params }: Readonly<{ params: Params }>) {
  const { assessmentId } = await params;
  const [{ user, error }, t, tRoot] = await Promise.all([
    requireRole(["TEACHER", "ADMIN"], isObjectId(assessmentId) ? gradeSheetHref(assessmentId) : GRADES_HREF),
    getTranslations("analytics.grades.sheet"),
    getTranslations("analytics"),
  ]);
  const errors = await getErrorFormatter();

  if (!user) {
    return (
      <div className="container space-y-6 py-6 sm:py-10">
        <PageHeader title={tRoot("gradesTitle")} />
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  const loaded = isObjectId(assessmentId) ? await loadSheet(assessmentId) : null;
  if (!loaded?.data) {
    const missing = !loaded || [400, 403, 404].includes(loaded.error.status);
    return (
      <div className="container space-y-6 py-6 sm:py-10">
        <PageHeader title={tRoot("gradesTitle")} />
        <EmptyState
          icon={ClipboardX}
          title={missing ? t("notFound") : errors.message(loaded.error)}
          action={
            <Link href={GRADES_HREF} className={cn(buttonVariants({ variant: "outline" }), "rounded-full")}>
              {t("back")}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="container max-w-5xl py-6 sm:py-10">
      <GradeSheetEditor initial={loaded.data} saveAction={saveGradesAction} publishAction={publishAssessmentAction} />
    </div>
  );
}
