"use client";

import { useId } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, CloudOff, RefreshCw } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useBookingFormat } from "@/components/bookings/use-booking-format";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonList } from "@/components/ui/skeleton";
import { addDays, timeKey, zonedTimeToUtc, type DateKey } from "@/lib/datetime";
import { useErrorFormatter } from "@/lib/i18n/client";
import type { OfflineQueryResult } from "@/lib/offline";
import {
  busyOnDay,
  CLOSE_TIME,
  freeIntervals,
  minutesOf,
  OPEN_TIME,
  openingInterval,
  type AvailabilityView,
  type Interval,
} from "@/lib/bookings/rules";
import type { Availability, BusySlot } from "@/lib/bookings/types";
import { cn } from "@/lib/utils";

export type PickedSlot = { date: DateKey; start: string; end: string };

const HOUR_REM = 2.75;
const OPEN_HOUR = minutesOf(OPEN_TIME) / 60;
const CLOSE_HOUR = minutesOf(CLOSE_TIME) / 60;
const HOURS = Array.from({ length: CLOSE_HOUR - OPEN_HOUR + 1 }, (_, index) => OPEN_HOUR + index);

/** Instant at noon of a campus day (to format the day itself). */
const noon = (day: DateKey) => zonedTimeToUtc(day, "12:00");

/** Label of a busy time: translated from `kind` for everyone, the API's details for admins. */
function useBusyLabel(isAdmin: boolean) {
  const t = useTranslations("bookings.availability");
  return (slot: BusySlot) => {
    if (slot.kind === "CLASS") return isAdmin && slot.label && slot.label !== "Class" ? t("classOf", { label: slot.label }) : t("class");
    if (slot.mine) return t("yourBooking", { purpose: slot.purpose ?? slot.label });
    if (isAdmin && slot.label && slot.label !== "Booked") return slot.label;
    return t("booked");
  };
}

const SLOT_MS = 15 * 60_000;

/**
 * Start of a click inside a free block of the timeline: the quarter hour under the pointer (a keyboard
 * activation, `detail === 0`, keeps the start of the block).
 */
function clickedInterval(event: React.MouseEvent<HTMLElement>, interval: Interval): Interval {
  const rect = event.currentTarget.getBoundingClientRect();
  if (event.detail === 0 || rect.height <= 0) return interval;
  const ratio = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
  const at = Math.floor((interval.start + ratio * (interval.end - interval.start)) / SLOT_MS) * SLOT_MS;
  return { start: Math.max(interval.start, Math.min(at, interval.end - SLOT_MS)), end: interval.end };
}

/** A free interval as a form selection: start, and one hour (or less when the interval is shorter). */
function pickOf(day: DateKey, interval: Interval, maxHours: number): PickedSlot {
  const start = timeKey(interval.start);
  const length = Math.min(interval.end - interval.start, 60 * 60_000, maxHours * 60 * 60_000);
  return { date: day, start, end: timeKey(interval.start + length) };
}

function busyClasses(slot: BusySlot) {
  return cn(
    "border text-foreground",
    slot.kind === "CLASS" && "border-border bg-muted",
    slot.kind === "BOOKING" && !slot.mine && "border-primary/30 bg-accent",
    slot.mine && "border-success/40 bg-success/10",
    slot.status === "PENDING" && "border-dashed"
  );
}

type Entry = { type: "busy"; start: number; end: number; slot: BusySlot } | { type: "free"; start: number; end: number };

function dayEntries(day: DateKey, busy: readonly BusySlot[], now: number, past: boolean): Entry[] {
  const open = openingInterval(day);
  const entries: Entry[] = busyOnDay(busy, day)
    .map((slot) => ({
      type: "busy" as const,
      start: Math.max(Date.parse(slot.startsAt), open.start),
      end: Math.min(Date.parse(slot.endsAt), open.end),
      slot,
    }))
    .filter((entry) => entry.end > entry.start);
  if (!past) entries.push(...freeIntervals(day, busy, now).map((interval) => ({ type: "free" as const, ...interval })));
  return entries.sort((a, b) => a.start - b.start);
}

/** Proportional timeline of one day (07:00-21:00): busy blocks, free times as buttons, the form's selection. */
function DayTimeline({
  day,
  busy,
  now,
  isAdmin,
  maxHours,
  selection,
  onPick,
}: {
  day: DateKey;
  busy: readonly BusySlot[];
  now: number;
  isAdmin: boolean;
  maxHours: number;
  selection: PickedSlot | null;
  onPick: (slot: PickedSlot) => void;
}) {
  const t = useTranslations("bookings.availability");
  const fmt = useBookingFormat();
  const busyLabel = useBusyLabel(isAdmin);
  const open = openingInterval(day);
  const span = open.end - open.start;
  const past = open.end <= now;
  const entries = dayEntries(day, busy, now, past);
  const position = (start: number, end: number) => ({
    top: `${((start - open.start) / span) * 100}%`,
    height: `${((end - start) / span) * 100}%`,
  });
  const nowInside = now > open.start && now < open.end;
  const selectionInterval =
    selection && selection.date === day ? { start: zonedTimeToUtc(day, selection.start).getTime(), end: zonedTimeToUtc(day, selection.end).getTime() } : null;
  const height = `${(CLOSE_HOUR - OPEN_HOUR) * HOUR_REM}rem`;

  if (past) return <p className="rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("dayOver")}</p>;

  return (
    <div className="flex gap-2" data-testid="availability-day">
      <div className="relative w-11 shrink-0 text-right text-xs tabular-nums text-muted-foreground" style={{ height }} aria-hidden="true">
        {HOURS.map((hour) => (
          <span key={hour} className="absolute right-0 -translate-y-1/2" style={{ top: `${((hour - OPEN_HOUR) / (CLOSE_HOUR - OPEN_HOUR)) * 100}%` }}>
            {String(hour).padStart(2, "0")}:00
          </span>
        ))}
      </div>
      <div className="relative min-w-0 flex-1 rounded-2xl border bg-background" style={{ height }}>
        {HOURS.slice(1, -1).map((hour) => (
          <span
            key={hour}
            aria-hidden="true"
            className="absolute inset-x-0 h-px bg-border"
            style={{ top: `${((hour - OPEN_HOUR) / (CLOSE_HOUR - OPEN_HOUR)) * 100}%` }}
          />
        ))}
        {nowInside && (
          <span aria-hidden="true" className="absolute inset-x-0 rounded-t-2xl bg-muted/60" style={{ top: 0, height: `${((now - open.start) / span) * 100}%` }} />
        )}
        {selectionInterval && selectionInterval.end > selectionInterval.start && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 z-20 rounded-xl border-2 border-primary"
            style={position(Math.max(selectionInterval.start, open.start), Math.min(selectionInterval.end, open.end))}
          />
        )}
        <ol className="absolute inset-0" aria-label={t("dayLabel", { day: fmt.day(noon(day)) })}>
          {entries.map((entry) => {
            const range = fmt.range(entry.start, entry.end);
            const short = entry.end - entry.start < 45 * 60_000;
            if (entry.type === "free") {
              return (
                <li key={`free-${entry.start}`} data-kind="FREE" className="absolute inset-x-1 z-10 py-0.5" style={position(entry.start, entry.end)}>
                  <button
                    type="button"
                    onClick={(event) => onPick(pickOf(day, clickedInterval(event, entry), maxHours))}
                    aria-label={t("useFree", { range })}
                    className={cn(
                      "flex h-full w-full items-start gap-2 rounded-xl border border-dashed border-success/50 px-2 py-1 text-left text-xs text-foreground transition-colors",
                      "hover:bg-success/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      short ? "items-center" : "flex-col gap-0.5"
                    )}
                  >
                    <span className="font-semibold">{t("free")}</span>
                    <span className="tabular-nums">{range}</span>
                    {!short && <span className="text-muted-foreground">{t("pickHint")}</span>}
                  </button>
                </li>
              );
            }
            const label = busyLabel(entry.slot);
            return (
              <li
                key={`busy-${entry.start}-${entry.slot.kind}`}
                data-kind={entry.slot.kind}
                data-status={entry.slot.status}
                data-mine={entry.slot.mine ? "true" : undefined}
                className="absolute inset-x-1 z-10 py-0.5"
                style={position(entry.start, entry.end)}
                title={`${range} · ${label}`}
              >
                <div className={cn("flex h-full min-h-0 overflow-hidden rounded-xl px-2 py-1 text-xs", busyClasses(entry.slot), short ? "items-center gap-2" : "flex-col")}>
                  <span className="font-semibold tabular-nums">{range}</span>
                  <span className={cn("min-w-0", short ? "truncate" : "line-clamp-2")}>
                    {label}
                    {entry.slot.status === "PENDING" && ` · ${t("pending")}`}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/** Week agenda: one card per day with its busy and free times (free times are buttons). */
function WeekAgenda({
  monday,
  busy,
  now,
  today,
  isAdmin,
  maxHours,
  selectedDate,
  onPick,
  onOpenDay,
}: {
  monday: DateKey;
  busy: readonly BusySlot[];
  now: number;
  today: DateKey;
  isAdmin: boolean;
  maxHours: number;
  selectedDate: DateKey | null;
  onPick: (slot: PickedSlot) => void;
  onOpenDay: (day: DateKey) => void;
}) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="availability-week">
      {days.map((day) => (
        <AgendaDay
          key={day}
          day={day}
          busy={busy}
          now={now}
          today={today}
          isAdmin={isAdmin}
          maxHours={maxHours}
          selected={day === selectedDate}
          onPick={onPick}
          onOpenDay={onOpenDay}
        />
      ))}
    </div>
  );
}

function AgendaDay({
  day,
  busy,
  now,
  today,
  isAdmin,
  maxHours,
  selected,
  onPick,
  onOpenDay,
}: {
  day: DateKey;
  busy: readonly BusySlot[];
  now: number;
  today: DateKey;
  isAdmin: boolean;
  maxHours: number;
  selected: boolean;
  onPick: (slot: PickedSlot) => void;
  onOpenDay: (day: DateKey) => void;
}) {
  const t = useTranslations("bookings.availability");
  const fmt = useBookingFormat();
  const busyLabel = useBusyLabel(isAdmin);
  const headingId = useId();
  const past = openingInterval(day).end <= now;
  const entries = dayEntries(day, busy, now, past);
  const dayLabel = fmt.day(noon(day));

  return (
    <section
      aria-labelledby={headingId}
      data-day={day}
      className={cn("min-w-0 space-y-2 rounded-2xl border bg-background p-3", selected && "border-primary ring-1 ring-primary", past && "opacity-70")}
    >
      <h4 id={headingId} className="flex items-center justify-between gap-2 text-sm font-semibold">
        <span aria-current={day === today ? "date" : undefined} className={cn(day === today && "text-primary")}>
          {dayLabel}
        </span>
        <button
          type="button"
          onClick={() => onOpenDay(day)}
          className="rounded-full px-2 py-0.5 text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("openDayLabel", { day: dayLabel })}
        >
          {t("openDay")}
        </button>
      </h4>
      {past ? (
        <p className="text-xs text-muted-foreground">{t("dayOver")}</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("noFree")}</p>
      ) : (
        <ol className="space-y-1.5">
          {entries.map((entry) => {
            const range = fmt.range(entry.start, entry.end);
            if (entry.type === "free") {
              return (
                <li key={`free-${entry.start}`} data-kind="FREE">
                  <button
                    type="button"
                    onClick={() => onPick(pickOf(day, entry, maxHours))}
                    aria-label={t("useFreeOn", { day: dayLabel, range })}
                    className="flex w-full items-center justify-between gap-2 rounded-xl border border-dashed border-success/50 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-success/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="font-semibold">{t("free")}</span>
                    <span className="tabular-nums">{range}</span>
                  </button>
                </li>
              );
            }
            return (
              <li
                key={`busy-${entry.start}-${entry.slot.kind}`}
                data-kind={entry.slot.kind}
                data-status={entry.slot.status}
                data-mine={entry.slot.mine ? "true" : undefined}
                className={cn("rounded-xl px-2.5 py-1.5 text-xs", busyClasses(entry.slot))}
              >
                <span className="font-semibold tabular-nums">{range}</span>{" "}
                <span className="break-words">
                  {busyLabel(entry.slot)}
                  {entry.slot.status === "PENDING" && ` · ${t("pending")}`}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/**
 * "Check availability": Day / Week views of the chosen resource (one offline query per week), with
 * Previous / Today / Next and the period as an h3. Free times fill the booking form when chosen.
 */
export function AvailabilityPanel({
  resourceName,
  query,
  view,
  date,
  monday,
  today,
  now,
  isAdmin,
  maxHours,
  selection,
  online,
  onView,
  onDate,
  onPick,
}: {
  resourceName: string;
  query: OfflineQueryResult<Availability>;
  view: AvailabilityView;
  date: DateKey;
  monday: DateKey;
  today: DateKey;
  now: number;
  isAdmin: boolean;
  maxHours: number;
  selection: PickedSlot | null;
  online: boolean;
  onView: (view: AvailabilityView) => void;
  onDate: (date: DateKey) => void;
  onPick: (slot: PickedSlot) => void;
}) {
  const t = useTranslations("bookings.availability");
  const tStates = useTranslations("common.states");
  const tActions = useTranslations("common.actions");
  const format = useFormatter();
  const errors = useErrorFormatter();
  const { data, savedAt, isLoading, isValidating, error, refresh } = query;

  const periodLabel =
    view === "day"
      ? format.dateTime(noon(date), "weekdayLong")
      : t("week", {
          from: format.dateTime(noon(monday), "dayMonth"),
          to: format.dateTime(noon(addDays(monday, 6)), { day: "numeric", month: "short", year: "numeric" }),
        });
  const step = view === "day" ? 1 : 7;
  const stale = savedAt !== null && (!online || error !== null);

  let content: React.ReactNode;
  if (isLoading) content = <SkeletonList rows={3} label={tStates("loading")} />;
  else if (!data) {
    const offline = !online || error?.isNetworkError || error?.code === "OFFLINE";
    content = (
      <EmptyState
        icon={offline ? CloudOff : RefreshCw}
        headingLevel="p"
        title={offline ? t("notSaved") : t("loadError")}
        description={offline ? t("notSavedHint") : error ? errors.message(error) : undefined}
        action={
          offline ? undefined : (
            <Button variant="outline" className="rounded-full" onClick={() => void refresh()} disabled={isValidating}>
              {tActions("tryAgain")}
            </Button>
          )
        }
      />
    );
  } else if (!data.bookable) {
    content = <EmptyState icon={CalendarClock} headingLevel="p" title={t("notBookable")} />;
  } else if (view === "day") {
    content = (
      <DayTimeline day={date} busy={data.busy} now={now} isAdmin={isAdmin} maxHours={maxHours} selection={selection} onPick={onPick} />
    );
  } else {
    content = (
      <WeekAgenda
        monday={monday}
        busy={data.busy}
        now={now}
        today={today}
        isAdmin={isAdmin}
        maxHours={maxHours}
        selectedDate={selection?.date ?? null}
        onPick={onPick}
        onOpenDay={(day) => {
          onDate(day);
          onView("day");
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-3xl border bg-card p-3 text-card-foreground sm:p-4 lg:flex-row lg:items-center lg:justify-between">
        <div role="group" aria-label={t("viewLabel")} className="inline-flex self-start rounded-full bg-muted p-1">
          {(["day", "week"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={value === view}
              onClick={() => onView(value)}
              className={cn(
                "min-h-9 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                value === view ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t(`views.${value}`)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
          <div role="group" aria-label={t("periodLabel")} className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="rounded-full" onClick={() => onDate(addDays(date, -step))}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">{t("previous")}</span>
            </Button>
            <Button variant="outline" className="rounded-full" onClick={() => onDate(today)}>
              {t("today")}
            </Button>
            <Button variant="outline" size="icon" className="rounded-full" onClick={() => onDate(addDays(date, step))}>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">{t("next")}</span>
            </Button>
          </div>
          <h3 aria-live="polite" className="min-w-0 px-1 text-base font-semibold first-letter:uppercase">
            <span className="sr-only">{resourceName} · </span>
            {periodLabel}
          </h3>
        </div>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label={t("legendLabel")}>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3 w-3 rounded border border-dashed border-success/50" />
          {t("legendFree")}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3 w-3 rounded border border-primary/30 bg-accent" />
          {t("legendBooked")}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3 w-3 rounded border border-success/40 bg-success/10" />
          {t("legendMine")}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3 w-3 rounded border bg-muted" />
          {t("legendClass")}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3 w-3 rounded border border-dashed border-primary/40" />
          {t("legendPending")}
        </li>
      </ul>

      {stale && <p className="text-sm text-muted-foreground">{t("savedCopy", { time: format.dateTime(new Date(savedAt), "dayMonthTime") })}</p>}
      {content}
      <p className="text-xs text-muted-foreground">{t("hoursHint", { open: OPEN_TIME, close: CLOSE_TIME })}</p>
    </div>
  );
}
