import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SessionList } from "@/components/analytics/session-list";
import type { SelectOption } from "@/components/analytics/url-select";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { toApiError } from "@/lib/api";
import { ATTENDANCE_HREF, buildQuery, sessionListRange } from "@/lib/analytics/paths";
import { isObjectId, personName, type SessionList as SessionListData } from "@/lib/analytics/types";
import { requireRole } from "@/lib/dal";
import { todayKey } from "@/lib/datetime";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverApi, serverApiOr } from "@/lib/server-api";
import type { Group, Paginated, User } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("analytics");
  return { title: t("attendanceMetaTitle") };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/** Milliseconds since epoch at render time (kept out of the component body). */
function renderedAt(): number {
  return Date.now();
}

/**
 * Attendance (TEACHER, ADMIN): the sessions of a 7-day window (`?date=` = last day, default today) with their
 * roll-call progress; each opens /dashboard/attendance/<sessionId>. ADMIN can filter by group and teacher.
 */
export default async function AttendancePage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const [{ user, error }, t, params] = await Promise.all([
    requireRole(["TEACHER", "ADMIN"], ATTENDANCE_HREF),
    getTranslations("analytics"),
    searchParams,
  ]);
  const errors = await getErrorFormatter();
  const header = <PageHeader title={t("attendanceTitle")} description={t("attendanceDescription")} />;

  if (!user) {
    return (
      <div className="container space-y-6 py-6 sm:py-10">
        {header}
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  const isAdmin = user.role === "ADMIN";
  const today = todayKey();
  const range = sessionListRange(first(params.date), today);
  const group = isAdmin && isObjectId(first(params.group)) ? first(params.group) : "";
  const teacher = isAdmin && isObjectId(first(params.teacher)) ? first(params.teacher) : "";

  let items: SessionListData["items"] = [];
  let loadError: string | null = null;
  try {
    const list = await serverApi<SessionListData>(`/attendance/sessions${buildQuery({ from: range.from, to: range.to, group, teacher })}`);
    items = Array.isArray(list?.items) ? list.items : [];
  } catch (e) {
    loadError = errors.message(toApiError(e));
  }

  let groupOptions: SelectOption[] = [];
  let teacherOptions: SelectOption[] = [];
  if (isAdmin) {
    const [groups, teachers] = await Promise.all([
      serverApiOr<Group[]>("/academic/groups", []),
      serverApiOr<Paginated<User> | null>("/users?role=TEACHER&limit=100", null),
    ]);
    groupOptions = (Array.isArray(groups) ? groups : []).map((entry) => ({ value: entry.id, label: entry.name }));
    teacherOptions = (teachers?.items ?? [])
      .map((entry) => ({ value: entry.id, label: personName(entry) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  return (
    <div className="container space-y-6 py-6 sm:py-10">
      {header}
      <SessionList
        items={items}
        range={range}
        today={today}
        now={renderedAt()}
        isAdmin={isAdmin}
        filters={{ group, teacher }}
        groupOptions={groupOptions}
        teacherOptions={teacherOptions}
        loadError={loadError}
      />
    </div>
  );
}
