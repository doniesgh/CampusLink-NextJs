import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AlertsPanel } from "@/components/analytics/alerts-panel";
import { FollowUpTabs, type FollowUpTab } from "@/components/analytics/follow-up-tabs";
import { GroupOverviewPanel } from "@/components/analytics/group-overview-panel";
import type { SelectOption } from "@/components/analytics/url-select";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { toApiError } from "@/lib/api";
import { buildQuery, FOLLOW_UP_HREF } from "@/lib/analytics/paths";
import { isObjectId, type AttendanceAlert, type GroupOverview } from "@/lib/analytics/types";
import { requireRole } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverApi, serverApiOr } from "@/lib/server-api";
import type { Group, Paginated, Subject } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("analytics");
  return { title: t("followUpMetaTitle") };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
const PAGE_SIZE = 20;

/**
 * Student follow-up (ADMIN): "Alerts" (absence alerts, filters group / level / subject, paginated) and "Groups"
 * (`?tab=groups&group=&subject=`: per-student attendance and averages of one group). Students link to
 * /dashboard/admin/analytics/students/<id> (detail + PDF report).
 */
export default async function StudentFollowUpPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const [{ user, error }, t, params] = await Promise.all([requireRole(["ADMIN"], FOLLOW_UP_HREF), getTranslations("analytics"), searchParams]);
  const errors = await getErrorFormatter();
  const header = <PageHeader title={t("followUpTitle")} description={t("followUpDescription")} />;

  if (!user) {
    return (
      <div className="container space-y-6 py-6 sm:py-10">
        {header}
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  const tab: FollowUpTab = first(params.tab) === "groups" ? "groups" : "alerts";
  const groupsList = await serverApiOr<Group[]>("/academic/groups", []);
  const groups = Array.isArray(groupsList) ? groupsList : [];
  const groupOptions: SelectOption[] = groups.map((group) => ({ value: group.id, label: group.name }));
  const groupParam = isObjectId(first(params.group)) ? first(params.group) : "";
  const subjectParam = isObjectId(first(params.subject)) ? first(params.subject) : "";

  let panel: React.ReactNode;
  if (tab === "alerts") {
    const levelParam = ["WARNING", "CRITICAL"].includes(first(params.level)) ? first(params.level) : "";
    const page = Math.max(1, Number.parseInt(first(params.page), 10) || 1);
    const [subjects, alertsResult] = await Promise.all([
      serverApiOr<Subject[]>("/academic/subjects", []),
      serverApi<Paginated<AttendanceAlert>>(
        `/attendance/alerts${buildQuery({ group: groupParam, level: levelParam, subject: subjectParam, page, limit: PAGE_SIZE })}`
      ).then(
        (data) => ({ data, error: null }),
        (e: unknown) => ({ data: null, error: errors.message(toApiError(e)) })
      ),
    ]);
    const list = alertsResult.data;
    panel = (
      <AlertsPanel
        alerts={list?.items ?? []}
        total={list?.total ?? 0}
        filters={{ group: groupParam, level: levelParam, subject: subjectParam }}
        groupOptions={groupOptions}
        subjectOptions={(Array.isArray(subjects) ? subjects : []).map((subject) => ({ value: subject.id, label: subject.name }))}
        loadError={alertsResult.error}
        footer={
          list ? (
            <Pagination
              pathname={FOLLOW_UP_HREF}
              searchParams={{ group: groupParam || undefined, level: levelParam || undefined, subject: subjectParam || undefined }}
              page={list.page ?? page}
              limit={list.limit ?? PAGE_SIZE}
              total={list.total ?? 0}
            />
          ) : undefined
        }
      />
    );
  } else {
    const groupId = groupParam && groups.some((group) => group.id === groupParam) ? groupParam : (groups[0]?.id ?? "");
    let overview: GroupOverview | null = null;
    let loadError: string | null = null;
    if (groupId) {
      try {
        overview = await serverApi<GroupOverview>(`/analytics/groups/${encodeURIComponent(groupId)}${buildQuery({ subject: subjectParam })}`);
      } catch (e) {
        loadError = errors.message(toApiError(e));
      }
    }
    panel = <GroupOverviewPanel overview={overview} filters={{ group: groupId, subject: subjectParam }} groupOptions={groupOptions} loadError={loadError} />;
  }

  return (
    <div className="container space-y-6 py-6 sm:py-10">
      {header}
      <FollowUpTabs tab={tab}>{panel}</FollowUpTabs>
    </div>
  );
}
