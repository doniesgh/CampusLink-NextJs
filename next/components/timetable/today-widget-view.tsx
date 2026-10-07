"use client";

import Link from "next/link";
import { ArrowRight, CalendarCheck, CalendarX, UsersRound } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useSessionChange } from "@/components/timetable/session-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonList } from "@/components/ui/skeleton";
import { dateKey, formatTimeRange } from "@/lib/datetime";
import { useOfflineQuery } from "@/lib/offline";
import { useNow } from "@/lib/timetable/client";
import { currentWeekRange, type TimetableRange } from "@/lib/timetable/range";
import { teacherName, type ClassSession, type TimetableResponse } from "@/lib/timetable/types";
import { cn } from "@/lib/utils";

/** One class of the day: time, subject (colour dot), room, teacher/groups, Cancelled / Moved from. */
function TodayItem({ session, now, showGroups }: { session: ClassSession; now: number; showGroups: boolean }) {
  const t = useTranslations("timetable.session");
  const { movedFrom, rescheduled } = useSessionChange(session);
  const cancelled = session.status === "CANCELLED";
  const inProgress = !cancelled && Date.parse(session.startsAt) <= now && now < Date.parse(session.endsAt);
  const subject = session.subject?.name ?? t("unknownSubject");
  // Teachers see the groups they teach, students see who teaches.
  const who = showGroups ? session.groups.map((group) => group.name).join(", ") : teacherName(session.teacher);
  const details = [session.room?.name ?? t("noRoom"), who].filter(Boolean).join(" · ");

  return (
    <article
      aria-label={subject}
      data-session-id={session.id}
      data-status={session.status}
      className={cn("flex gap-3 rounded-2xl px-3 py-2.5", inProgress ? "bg-success/10" : "bg-muted/60", cancelled && "opacity-90")}
    >
      <span
        aria-hidden="true"
        className="mt-1 h-8 w-1 shrink-0 rounded-full"
        style={{ backgroundColor: session.subject?.color ?? "var(--muted-foreground)" }}
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className={cn("text-xs font-semibold tabular-nums text-muted-foreground", cancelled && "line-through")}>
          {formatTimeRange(session.startsAt, session.endsAt)}
        </p>
        <h3 className="truncate text-sm font-semibold">{subject}</h3>
        <p className="truncate text-xs text-muted-foreground">{details}</p>
        {(cancelled || movedFrom || rescheduled || inProgress) && (
          <div className="flex flex-wrap gap-1 pt-1">
            {cancelled && <Badge variant="danger">{t("cancelled")}</Badge>}
            {movedFrom && <Badge variant="warning">{movedFrom}</Badge>}
            {rescheduled && <Badge variant="warning" className="whitespace-normal">{rescheduled}</Badge>}
            {inProgress && <Badge variant="success">{t("inProgress")}</Badge>}
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * Client part of the "Today's classes" widget: the current week (offline query shared with the
 * timetable page), today's classes, or the next class of the week when today is free.
 */
export function TodayWidgetView({
  initial,
  renderedAt,
  showGroups = false,
}: {
  initial: TimetableResponse | null;
  renderedAt: number;
  /** Teachers: show the groups instead of the teacher. */
  showGroups?: boolean;
}) {
  const now = useNow(renderedAt);
  const range = currentWeekRange(dateKey(now));
  const seeded = initial !== null && currentWeekRange(dateKey(renderedAt)).id === range.id;
  // One query per week (remounted when the week changes while the dashboard stays open).
  return <TodayCard key={range.id} range={range} now={now} initial={seeded ? initial : null} renderedAt={renderedAt} showGroups={showGroups} />;
}

function TodayCard({
  range,
  now,
  initial,
  renderedAt,
  showGroups,
}: {
  range: TimetableRange;
  now: number;
  initial: TimetableResponse | null;
  renderedAt: number;
  showGroups: boolean;
}) {
  const t = useTranslations("timetable.widget");
  const tStates = useTranslations("common.states");
  const format = useFormatter();
  const today = dateKey(now);
  const seeded = initial !== null;
  const { data, isLoading, error } = useOfflineQuery<TimetableResponse>(range.key, range.path, {
    fallbackData: initial ?? undefined,
    fallbackSavedAt: seeded ? renderedAt : undefined,
    revalidateOnMount: !seeded,
  });

  const items = data?.items ?? [];
  const todays = items.filter((session) => dateKey(session.startsAt) === today);
  const next = todays.length === 0 ? items.find((session) => session.status !== "CANCELLED" && Date.parse(session.startsAt) > now) : undefined;

  let content: React.ReactNode;
  if (isLoading) {
    content = <SkeletonList rows={2} label={tStates("loading")} />;
  } else if (data?.hint === "NO_GROUP") {
    content = (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
        <UsersRound className="h-5 w-5 text-primary" aria-hidden="true" />
        <p>{t("noGroup")}</p>
      </div>
    );
  } else if (!data) {
    content = (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
        <CalendarX className="h-5 w-5" aria-hidden="true" />
        <p>{error ? t("error") : t("empty")}</p>
      </div>
    );
  } else if (todays.length === 0) {
    content = (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
        <CalendarCheck className="h-5 w-5 text-primary" aria-hidden="true" />
        <p>{t("empty")}</p>
        {next && (
          <p className="font-medium text-foreground">
            {t("next", {
              when: `${format.dateTime(new Date(next.startsAt), "weekdayDayMonth")}, ${formatTimeRange(next.startsAt, next.endsAt)} · ${next.subject?.name ?? ""}`,
            })}
          </p>
        )}
      </div>
    );
  } else {
    content = (
      <ol className="space-y-2">
        {todays.map((session) => (
          <li key={session.id}>
            <TodayItem session={session} now={now} showGroups={showGroups} />
          </li>
        ))}
      </ol>
    );
  }

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        {data && !data.hint && <CardDescription>{format.dateTime(new Date(now), "weekdayLong")}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {content}
        <Link
          href="/dashboard/timetable"
          className="mt-auto inline-flex items-center gap-1.5 self-start rounded-lg text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("viewAll")}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  );
}
