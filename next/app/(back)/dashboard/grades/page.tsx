import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { GradesManager } from "@/components/analytics/grades-manager";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { toApiError } from "@/lib/api";
import { buildQuery, GRADES_HREF } from "@/lib/analytics/paths";
import type { Assessment, AssessmentList, TeachingList, TeachingPair } from "@/lib/analytics/types";
import { requireRole } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverApi } from "@/lib/server-api";
import { deleteAssessmentAction, publishAssessmentAction, saveAssessmentAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("analytics");
  return { title: t("gradesMetaTitle") };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/**
 * Grades (TEACHER, ADMIN): pick a class (`?subject=&group=`, default the first pair the user teaches), see its
 * assessments, create / edit / publish / delete them; grade entry on /dashboard/grades/<assessmentId>.
 */
export default async function GradesPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const [{ user, error }, t, params] = await Promise.all([requireRole(["TEACHER", "ADMIN"], GRADES_HREF), getTranslations("analytics"), searchParams]);
  const errors = await getErrorFormatter();
  const header = <PageHeader title={t("gradesTitle")} description={t("gradesDescription")} />;

  if (!user) {
    return (
      <div className="container space-y-6 py-6 sm:py-10">
        {header}
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  let pairs: TeachingPair[] = [];
  let loadError: string | null = null;
  try {
    const teaching = await serverApi<TeachingList>("/grades/teaching");
    pairs = Array.isArray(teaching?.items) ? teaching.items : [];
  } catch (e) {
    loadError = errors.message(toApiError(e));
  }

  const subject = first(params.subject);
  const group = first(params.group);
  const selected = pairs.find((pair) => pair.subject.id === subject && pair.group.id === group) ?? pairs[0] ?? null;

  let assessments: Assessment[] = [];
  if (selected) {
    try {
      const list = await serverApi<AssessmentList>(`/grades/assessments${buildQuery({ subject: selected.subject.id, group: selected.group.id, limit: 100 })}`);
      assessments = Array.isArray(list?.items) ? list.items : [];
    } catch (e) {
      loadError = errors.message(toApiError(e));
    }
  }

  return (
    <div className="container space-y-6 py-6 sm:py-10">
      {header}
      {loadError && !selected ? (
        <InlineFeedback feedback={{ type: "error", message: loadError }} />
      ) : (
        <GradesManager
          pairs={pairs}
          selected={selected}
          assessments={assessments}
          loadError={loadError}
          isAdmin={user?.role === "ADMIN"}
          actions={{ save: saveAssessmentAction, remove: deleteAssessmentAction, publish: publishAssessmentAction }}
        />
      )}
    </div>
  );
}
