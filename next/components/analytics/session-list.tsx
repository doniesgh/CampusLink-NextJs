"use client";

import Link from "@/components/ui/app-link";
import { CalendarX, ChevronLeft, ChevronRight, ClipboardCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { SubjectLabel } from "@/components/analytics/level-badge";
import { UrlSelect, type SelectOption } from "@/components/analytics/url-select";
import { useAnalyticsFormat } from "@/components/analytics/use-analytics-format";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback } from "@/components/ui/feedback";
import { ATTENDANCE_HREF, buildQuery, rollCallHref } from "@/lib/analytics/paths";
import { personName, type SessionListItem } from "@/lib/analytics/types";
import { addDays, dateKey, formatTimeRange, type DateKey } from "@/lib/datetime";
import { cn } from "@/lib/utils";

const OPENS_BEFORE_MS = 15 * 60 * 1000;

type RollCallState = "cancelled" | "open" | "notOpen" | "closed";

function stateOf(item: SessionListItem, now: number): RollCallState {
  if (item.session.status === "CANCELLED") return "cancelled";
  if (item.editable) return "open";
  return now < new Date(item.session.startsAt).getTime() - OPENS_BEFORE_MS ? "notOpen" : "closed";
}

function SessionCard({ item, now, showTeacher }: { item: SessionListItem; now: number; showTeacher: boolean }) {
  const t = useTranslations("analytics.attendance");
  const tTypes = useTranslations("timetable.session.types");
  const fmt = useAnalyticsFormat();
  const { session, rollCall } = item;
  const state = stateOf(item, now);
  const complete = rollCall.students > 0 && rollCall.marked >= rollCall.students;
  const time = formatTimeRange(session.startsAt, session.endsAt);
  const groups = session.groups.map((group) => group.name).join(", ");
  const action = state === "open" ? (rollCall.marked > 0 ? "edit" : "take") : "view";
  const stateBadge =
    state === "cancelled" ? (
      <Badge variant="danger">{t("states.cancelled")}</Badge>
    ) : state === "open" ? (
      complete ? <Badge variant="success">{t("states.complete")}</Badge> : <Badge variant="secondary">{t("states.open")}</Badge>
    ) : state === "notOpen" ? (
      <Badge variant="outline">{t("states.notOpen", { time: fmt.time(new Date(new Date(session.startsAt).getTime() - OPENS_BEFORE_MS)) })}</Badge>
    ) : (
      <Badge variant="neutral">{t("states.closed")}</Badge>
    );

  return (
    <article
      className="flex flex-col gap-3 rounded-2xl border bg-card p-4 text-card-foreground sm:flex-row sm:items-center"
      data-session-id={session.id}
      data-status={session.status}
      data-state={state}
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 font-semibold text-foreground">
            <SubjectLabel subject={session.subject} />
          </h3>
          <Badge variant="neutral">{tTypes(session.type)}</Badge>
          {stateBadge}
        </div>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium tabular-nums text-foreground">{time}</span>
          {groups && <> · {t("groupsLabel", { groups })}</>}
          {" · "}
          {session.room ? t("roomLabel", { room: session.room.name }) : t("noRoom")}
          {showTeacher && session.teacher && <> · {personName(session.teacher)}</>}
        </p>
        {state !== "cancelled" && (
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm" aria-label={t("countsLabel")}>
            <span className="font-medium">{t("marked", { marked: rollCall.marked, students: rollCall.students })}</span>
            {rollCall.counts.ABSENT > 0 && <span className="text-destructive">{t("absentCount", { count: rollCall.counts.ABSENT })}</span>}
            {rollCall.counts.LATE > 0 && <span>{t("lateCount", { count: rollCall.counts.LATE })}</span>}
            {rollCall.counts.EXCUSED > 0 && <span>{t("excusedCount", { count: rollCall.counts.EXCUSED })}</span>}
          </p>
        )}
      </div>
      {state !== "cancelled" && (
        <Link
          href={rollCallHref(session.id)}
          className={cn(buttonVariants({ variant: action === "take" ? "default" : "outline", size: "sm" }), "shrink-0 self-start rounded-full sm:self-center")}
        >
          <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
          {t(action)}
          <span className="sr-only">
            {" "}
            ({session.subject?.name ?? ""}, {fmt.day(session.startsAt)} {time})
          </span>
        </Link>
      )}
    </article>
  );
}

/**
 * Sessions of a 7-day window (teacher: the sessions they teach; admin: all, with Group / Teacher filters), grouped
 * by day with today first. Each session links to its roll call.
 */
export function SessionList({
  items,
  range,
  today,
  now,
  isAdmin,
  filters,
  groupOptions,
  teacherOptions,
  loadError,
}: {
  items: SessionListItem[];
  range: { end: DateKey; from: DateKey; isCurrent: boolean };
  today: DateKey;
  now: number;
  isAdmin: boolean;
  filters: { group: string; teacher: string };
  groupOptions: SelectOption[];
  teacherOptions: SelectOption[];
  loadError: string | null;
}) {
  const t = useTranslations("analytics.attendance");
  const tActions = useTranslations("common.actions");
  const fmt = useAnalyticsFormat();

  const byDay = new Map<DateKey, SessionListItem[]>();
  for (const item of items) {
    const day = dateKey(item.session.startsAt);
    byDay.set(day, [...(byDay.get(day) ?? []), item]);
  }
  const days = [...byDay.keys()].sort((a, b) => (a < b ? 1 : -1));
  const query = { date: range.isCurrent ? undefined : range.end, group: filters.group || undefined, teacher: filters.teacher || undefined };
  const periodHref = (end: DateKey | null) => `${ATTENDANCE_HREF}${buildQuery({ ...query, date: end && end < today ? end : null })}`;
  const navClass = cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-full");

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-foreground" aria-live="polite">
          {t("periodLabel", { from: fmt.day(range.from), to: fmt.day(range.end) })}
        </h2>
        <nav aria-label={t("changePeriod")} className="flex flex-wrap gap-2">
          <Link href={periodHref(addDays(range.end, -7))} className={navClass}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {t("previous")}
          </Link>
          {!range.isCurrent && (
            <>
              <Link href={periodHref(addDays(range.end, 7))} className={navClass}>
                {t("next")}
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link href={periodHref(null)} className={navClass}>
                {t("today")}
              </Link>
            </>
          )}
        </nav>
      </div>

      {isAdmin && (
        <fieldset className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
          <legend className="sr-only">{t("filters")}</legend>
          <UrlSelect id="attendance-group" label={t("group")} param="group" value={filters.group} options={groupOptions} allLabel={t("allGroups")} query={query} />
          <UrlSelect
            id="attendance-teacher"
            label={t("teacher")}
            param="teacher"
            value={filters.teacher}
            options={teacherOptions}
            allLabel={t("allTeachers")}
            query={query}
          />
        </fieldset>
      )}

      {loadError && <InlineFeedback feedback={{ type: "error", message: `${t("loadError")} ${loadError}` }} />}

      {!loadError && items.length === 0 && (
        <EmptyState
          icon={CalendarX}
          title={t("empty")}
          description={isAdmin ? undefined : t("emptyHint")}
          action={
            isAdmin && (filters.group || filters.teacher) ? (
              <Link href={`${ATTENDANCE_HREF}${buildQuery({ date: query.date })}`} className={navClass}>
                {tActions("resetFilters")}
              </Link>
            ) : undefined
          }
        />
      )}

      {days.map((day) => (
        <section key={day} aria-labelledby={`day-${day}`} className="space-y-3" data-day={day}>
          <h2 id={`day-${day}`} className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {day === today ? `${t("todayHeading")} · ${fmt.weekday(day)}` : fmt.weekday(day)}
          </h2>
          <div className="space-y-3">
            {(byDay.get(day) ?? []).map((item) => (
              <SessionCard key={item.session.id} item={item} now={now} showTeacher={isAdmin} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
