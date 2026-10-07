"use client";

import { useEffect, useRef } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { NoClasses } from "@/components/timetable/period-views";
import { SessionCard } from "@/components/timetable/session-card";
import { addDays, dateKey, startOfWeek, type DateKey } from "@/lib/datetime";
import { dayToDate, daysBetween, groupByDay, monthGrid } from "@/lib/timetable/range";
import type { ClassSession } from "@/lib/timetable/types";
import { cn } from "@/lib/utils";

const MAX_ENTRIES = 3;

// Day to focus after a keyboard move (also across months, when the grid remounts with new data).
let pendingFocus: DateKey | null = null;

function requestFocus(day: DateKey | null): void {
  pendingFocus = day;
}

/**
 * Month view: a calendar grid (whole weeks, Monday first) where each day is a button
 * ("Thursday, October 8: 3 classes"); the selected day's classes are listed below as full cards.
 * Keyboard: arrows move by day/week, Home/End to the start/end of the week (roving tabindex).
 */
export function MonthView({
  date,
  today,
  now,
  sessions,
  filtered,
  onSelectDate,
  emptyAction,
}: {
  date: DateKey;
  today: DateKey;
  now: number;
  sessions: ClassSession[];
  filtered: boolean;
  onSelectDate: (day: DateKey) => void;
  emptyAction?: React.ReactNode;
}) {
  const t = useTranslations("timetable");
  const format = useFormatter();
  const gridRef = useRef<HTMLUListElement>(null);
  const { from, to, month } = monthGrid(date);
  const days = daysBetween(from, to);
  const byDay = groupByDay(sessions);
  const monthLabel = format.dateTime(dayToDate(date), { month: "long", year: "numeric" });
  const inMonth = (day: DateKey) => day.startsWith(month);
  const monthCount = sessions.filter((session) => inMonth(dateKey(session.startsAt))).length;
  const selected = byDay.get(date) ?? [];

  useEffect(() => {
    if (!pendingFocus) return;
    const button = gridRef.current?.querySelector<HTMLButtonElement>(`button[data-day="${pendingFocus}"]`);
    if (button) {
      button.focus();
      requestFocus(null);
    }
  }, [date]);

  const move = (event: React.KeyboardEvent<HTMLButtonElement>, day: DateKey) => {
    const target =
      event.key === "ArrowLeft"
        ? addDays(day, -1)
        : event.key === "ArrowRight"
          ? addDays(day, 1)
          : event.key === "ArrowUp"
            ? addDays(day, -7)
            : event.key === "ArrowDown"
              ? addDays(day, 7)
              : event.key === "Home"
                ? startOfWeek(day)
                : event.key === "End"
                  ? addDays(startOfWeek(day), 6)
                  : null;
    if (!target) return;
    event.preventDefault();
    requestFocus(target);
    onSelectDate(target);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border bg-card p-2 sm:p-3">
        <div className="grid grid-cols-7 gap-1 pb-1" aria-hidden="true">
          {days.slice(0, 7).map((day) => (
            <span key={day} className="py-1 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {format.dateTime(dayToDate(day), { weekday: "short" })}
            </span>
          ))}
        </div>
        <ul ref={gridRef} aria-label={t("month.gridLabel", { month: monthLabel })} className="grid grid-cols-7 gap-1">
          {days.map((day) => {
            const list = byDay.get(day) ?? [];
            const isSelected = day === date;
            const isToday = day === today;
            const label = t("month.dayLabel", {
              date: format.dateTime(dayToDate(day), "weekdayLong"),
              count: list.length,
            });
            return (
              <li key={day} className="min-w-0">
                <button
                  type="button"
                  data-day={day}
                  tabIndex={isSelected ? 0 : -1}
                  aria-label={label}
                  aria-pressed={isSelected}
                  aria-current={isToday ? "date" : undefined}
                  onClick={() => onSelectDate(day)}
                  onKeyDown={(event) => move(event, day)}
                  className={cn(
                    "flex h-14 w-full flex-col items-stretch gap-1 rounded-xl border p-1 text-left transition-colors sm:h-24 sm:p-1.5",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                    inMonth(day) ? "bg-background" : "bg-muted/50 text-muted-foreground",
                    isSelected ? "border-primary ring-1 ring-primary" : "border-transparent hover:border-border hover:bg-accent/50"
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-6 w-6 items-center justify-center self-center rounded-full text-xs font-semibold sm:self-start",
                      isToday && "bg-primary text-primary-foreground"
                    )}
                  >
                    {Number(day.slice(8, 10))}
                  </span>
                  {/* Phones: one dot per class. Larger screens: the first classes. */}
                  <span aria-hidden="true" className="flex flex-wrap justify-center gap-0.5 sm:hidden">
                    {list.slice(0, 4).map((session) => (
                      <span
                        key={session.id}
                        className={cn("h-1.5 w-1.5 rounded-full", session.status === "CANCELLED" && "opacity-40")}
                        style={{ backgroundColor: session.subject?.color ?? "currentColor" }}
                      />
                    ))}
                  </span>
                  <span aria-hidden="true" className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                    {list.slice(0, MAX_ENTRIES).map((session) => (
                      <span
                        key={session.id}
                        className={cn(
                          "flex min-w-0 items-center gap-1 rounded-md px-1 text-[11px] leading-4",
                          session.status === "CANCELLED" && "line-through opacity-60"
                        )}
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: session.subject?.color ?? "currentColor" }} />
                        <span className="truncate">{session.subject?.code ?? session.subject?.name}</span>
                      </span>
                    ))}
                    {list.length > MAX_ENTRIES && (
                      <span className="px-1 text-[11px] leading-4 text-muted-foreground">
                        {t("month.more", { count: list.length - MAX_ENTRIES })}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {monthCount === 0 ? (
        <NoClasses filtered={filtered} action={emptyAction} />
      ) : (
        <section aria-labelledby="timetable-selected-day" className="space-y-3">
          <h3 id="timetable-selected-day" className="text-lg font-semibold">
            {format.dateTime(dayToDate(date), "weekdayLong")}
          </h3>
          {selected.length === 0 ? (
            <p className="rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("month.emptyDay")}</p>
          ) : (
            <ol className="space-y-3">
              {selected.map((session) => (
                <li key={session.id}>
                  <SessionCard session={session} headingLevel="h4" now={now} />
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}
