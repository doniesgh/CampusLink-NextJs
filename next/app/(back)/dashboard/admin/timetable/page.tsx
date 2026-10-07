import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { toApiError } from "@/lib/api";
import { addDays, isDateKey, startOfWeek, todayKey } from "@/lib/datetime";
import { requireRole } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverApi } from "@/lib/server-api";
import { isObjectId } from "@/lib/timetable/range";
import type { TimetableResponse } from "@/lib/timetable/types";
import type { Group, Paginated, Room, Subject, User } from "@/lib/types";
import { TimetableManager, type ManagerTeacher, type TargetKind } from "./timetable-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("timetable");
  return { title: t("managementTitle") };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TARGET_KINDS: readonly TargetKind[] = ["group", "teacher", "room"];
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/** Every TEACHER account (the users API pages by 100 at most). */
async function loadTeachers(): Promise<ManagerTeacher[]> {
  const teachers: ManagerTeacher[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const list = await serverApi<Paginated<User>>(`/users?role=TEACHER&limit=100&page=${page}`);
    teachers.push(...list.items.map(({ id, firstname, lastname, email }) => ({ id, firstname, lastname, email })));
    if (list.items.length === 0 || teachers.length >= list.total) break;
  }
  return teachers.sort((a, b) => `${a.firstname} ${a.lastname}`.localeCompare(`${b.firstname} ${b.lastname}`));
}

/**
 * Timetable management (ADMIN): week grid of one group, teacher or room (`?by=group|teacher|room
 * &id=<id>&date=YYYY-MM-DD`), add / edit / cancel / delete sessions (Server Actions) and CSV import.
 * Server-rendered: changing the target or the week navigates; actions refresh the page.
 */
export default async function TimetableManagementPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const [{ user, error }, t, params] = await Promise.all([
    requireRole(["ADMIN"], "/dashboard/admin/timetable"),
    getTranslations("timetable"),
    searchParams,
  ]);
  const errors = await getErrorFormatter();

  if (!user) {
    return (
      <div className="container space-y-6 py-6 sm:py-10">
        <PageHeader title={t("managementTitle")} />
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  const byParam = first(params.by);
  const by: TargetKind = TARGET_KINDS.includes(byParam as TargetKind) ? (byParam as TargetKind) : "group";
  const dateParam = first(params.date);
  const today = todayKey();
  const date = isDateKey(dateParam) ? dateParam : today;
  const monday = startOfWeek(date);

  let lists: { groups: Group[]; subjects: Subject[]; rooms: Room[]; teachers: ManagerTeacher[] } | null = null;
  let loadError: string | null = null;
  try {
    const [groups, subjects, rooms, teachers] = await Promise.all([
      serverApi<Group[]>("/academic/groups"),
      serverApi<Subject[]>("/academic/subjects"),
      serverApi<Room[]>("/academic/rooms"),
      loadTeachers(),
    ]);
    lists = { groups, subjects, rooms, teachers };
  } catch (e) {
    loadError = errors.message(toApiError(e));
  }

  if (!lists) {
    return (
      <div className="container space-y-6 py-6 sm:py-10">
        <PageHeader title={t("managementTitle")} />
        <InlineFeedback feedback={{ type: "error", message: loadError ?? "" }} />
      </div>
    );
  }

  const targets = by === "group" ? lists.groups : by === "teacher" ? lists.teachers : lists.rooms;
  const idParam = first(params.id);
  const targetId = isObjectId(idParam) && targets.some((target) => target.id === idParam) ? idParam : (targets[0]?.id ?? null);

  let week: TimetableResponse | null = null;
  let weekError: string | null = null;
  if (targetId) {
    try {
      week = await serverApi<TimetableResponse>(`/timetable?${by}=${targetId}&from=${monday}&to=${addDays(monday, 7)}`);
    } catch (e) {
      weekError = errors.message(toApiError(e));
    }
  }

  return (
    <div className="container py-6 sm:py-10">
      <TimetableManager
        by={by}
        targetId={targetId}
        date={date}
        today={today}
        groups={lists.groups}
        subjects={lists.subjects}
        rooms={lists.rooms}
        teachers={lists.teachers}
        sessions={week?.items ?? []}
        weekError={weekError}
      />
    </div>
  );
}
