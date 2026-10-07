"use client";

import { useId } from "react";
import { CalendarCheck } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { SessionCard } from "@/components/timetable/session-card";
import { EmptyState } from "@/components/ui/empty-state";
import { addDays, type DateKey } from "@/lib/datetime";
import { dayToDate, groupByDay, weekDays } from "@/lib/timetable/range";
import type { ClassSession } from "@/lib/timetable/types";
import { cn } from "@/lib/utils";

/**
 * "Oct 5 – Oct 11, 2026" / "5 oct. – 11 oct. 2026". Built from two single dates on purpose:
 * Intl's formatRange output differs between Node's and the browser's ICU (hydration mismatch).
 */
export function useWeekLabel(): (monday: DateKey) => string {
  const t = useTranslations("timetable.period");
  const format = useFormatter();
  return (monday) =>
    t("week", {
      from: format.dateTime(dayToDate(monday), "dayMonth"),
      to: format.dateTime(dayToDate(addDays(monday, 6)), { day: "numeric", month: "short", year: "numeric" }),
    });
}

/** "No classes in this period." (+ a hint, or a different one when filters hide everything). */
export function NoClasses({ filtered, action }: { filtered?: boolean; action?: React.ReactNode }) {
  const t = useTranslations("timetable");
  return (
    <EmptyState
      icon={CalendarCheck}
      title={t("empty")}
      description={filtered ? t("emptyFiltered") : t("emptyHint")}
      action={action}
    />
  );
}

/** Day view: the classes of one day as full cards. */
export function DayView({
  sessions,
  now,
  filtered,
  emptyAction,
}: {
  sessions: ClassSession[];
  now: number;
  filtered: boolean;
  emptyAction?: React.ReactNode;
}) {
  if (sessions.length === 0) return <NoClasses filtered={filtered} action={emptyAction} />;
  return (
    <ol className="space-y-3">
      {sessions.map((session) => (
        <li key={session.id}>
          <SessionCard session={session} headingLevel="h3" now={now} />
        </li>
      ))}
    </ol>
  );
}

/** One day column of the week grid (heading + compact cards). */
function DayColumn({
  day,
  sessions,
  today,
  now,
  onOpen,
}: {
  day: DateKey;
  sessions: ClassSession[];
  today: DateKey;
  now?: number;
  onOpen?: (session: ClassSession) => void;
}) {
  const t = useTranslations("timetable");
  const format = useFormatter();
  const headingId = useId();
  const isToday = day === today;
  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-2">
      <h3
        id={headingId}
        aria-current={isToday ? "date" : undefined}
        className={cn(
          "sticky top-14 z-10 flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-semibold lg:static",
          isToday ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
        )}
      >
        {format.dateTime(dayToDate(day), "weekdayDayMonth")}
      </h3>
      {sessions.length === 0 ? (
        <p className="rounded-xl border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">{t("freeDay")}</p>
      ) : (
        <ol className="space-y-2">
          {sessions.map((session) => (
            <li key={session.id}>
              <SessionCard session={session} headingLevel="h4" variant="compact" now={now} onOpen={onOpen} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * Week grid: one column per day (Monday..Friday, plus the weekend when it has classes). Columns on
 * large screens, stacked days below. `allSessions` (unfiltered) decides which weekend days appear.
 */
export function WeekGrid({
  monday,
  sessions,
  allSessions,
  today,
  now,
  onOpen,
}: {
  monday: DateKey;
  sessions: ClassSession[];
  allSessions: ClassSession[];
  today: DateKey;
  now?: number;
  onOpen?: (session: ClassSession) => void;
}) {
  const byDay = groupByDay(sessions);
  const days = weekDays(monday, groupByDay(allSessions));
  const columns = days.length === 7 ? "lg:grid-cols-7" : days.length === 6 ? "lg:grid-cols-6" : "lg:grid-cols-5";
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 lg:gap-3", columns)}>
      {days.map((day) => (
        <DayColumn key={day} day={day} sessions={byDay.get(day) ?? []} today={today} now={now} onOpen={onOpen} />
      ))}
    </div>
  );
}
