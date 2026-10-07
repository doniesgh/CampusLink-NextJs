"use client";

import { useMemo } from "react";
import Link from "@/components/ui/app-link";
import { CalendarCog, ChevronLeft, ChevronRight, CloudOff, RefreshCw, UsersRound } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { CalendarLinkPanel, ExportMenu, useCalendarExport } from "@/components/timetable/export-menu";
import { MonthView } from "@/components/timetable/month-view";
import { DayView, NoClasses, useWeekLabel, WeekGrid } from "@/components/timetable/period-views";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback, useFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { SkeletonList } from "@/components/ui/skeleton";
import { dateKey, type DateKey } from "@/lib/datetime";
import { useErrorFormatter } from "@/lib/i18n/client";
import { useOfflineQuery, useOnlineStatus } from "@/lib/offline";
import { setSearch, useLocationSearch, useMediaQuery, useNow } from "@/lib/timetable/client";
import {
  dayToDate,
  myTimetableRange,
  parseTimetableParams,
  shiftDate,
  TIMETABLE_VIEWS,
  timetableQuery,
  type TimetableRange,
  type TimetableUrlState,
  type TimetableView as View,
} from "@/lib/timetable/range";
import { teacherName, type ClassSession, type TimetableResponse } from "@/lib/timetable/types";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Below this width the day view is the default (phones). */
export const NARROW_QUERY = "(max-width: 639px)";

export type InitialTimetable = { id: string; data: TimetableResponse | null; savedAt: number };

type Option = { value: string; label: string };

function sortedOptions(entries: Map<string, string>): Option[] {
  return [...entries].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

/** Subject / Teacher filters (native selects), options from the loaded period. */
function Filters({
  sessions,
  subject,
  teacher,
  onChange,
}: {
  sessions: ClassSession[];
  subject: string | null;
  teacher: string | null;
  onChange: (patch: Partial<TimetableUrlState>) => void;
}) {
  const t = useTranslations("timetable.filters");
  const { subjects, teachers } = useMemo(() => {
    const subjectMap = new Map<string, string>();
    const teacherMap = new Map<string, string>();
    for (const session of sessions) {
      if (session.subject) subjectMap.set(session.subject.id, session.subject.name);
      if (session.teacher) teacherMap.set(session.teacher.id, teacherName(session.teacher));
    }
    if (subject && !subjectMap.has(subject)) subjectMap.set(subject, t("selected"));
    if (teacher && !teacherMap.has(teacher)) teacherMap.set(teacher, t("selected"));
    return { subjects: sortedOptions(subjectMap), teachers: sortedOptions(teacherMap) };
  }, [sessions, subject, teacher, t]);

  return (
    <fieldset className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
      <legend className="sr-only">{t("label")}</legend>
      <div className="space-y-1.5">
        <label htmlFor="timetable-subject" className="block text-sm font-medium">
          {t("subject")}
        </label>
        <Select id="timetable-subject" value={subject ?? ""} onChange={(event) => onChange({ subject: event.target.value || null })}>
          <option value="">{t("allSubjects")}</option>
          {subjects.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="timetable-teacher" className="block text-sm font-medium">
          {t("teacher")}
        </label>
        <Select id="timetable-teacher" value={teacher ?? ""} onChange={(event) => onChange({ teacher: event.target.value || null })}>
          <option value="">{t("allTeachers")}</option>
          {teachers.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
    </fieldset>
  );
}

/**
 * Data of one period (remounted for each range, so the offline query starts from the right
 * server-rendered snapshot) + filters + the day / week / month content.
 */
function PeriodContent({
  range,
  view,
  date,
  today,
  now,
  urlState,
  personal,
  initial,
  onNavigate,
}: {
  range: TimetableRange;
  view: View;
  date: DateKey;
  today: DateKey;
  now: number;
  urlState: TimetableUrlState;
  personal: boolean;
  initial: InitialTimetable | null;
  onNavigate: (patch: Partial<TimetableUrlState>, options?: { replace?: boolean }) => void;
}) {
  const t = useTranslations("timetable");
  const tStates = useTranslations("common.states");
  const tActions = useTranslations("common.actions");
  const format = useFormatter();
  const errors = useErrorFormatter();
  const online = useOnlineStatus();
  const seeded = initial !== null && initial.id === range.id && initial.data !== null;
  const { data, savedAt, isLoading, isValidating, error, refresh } = useOfflineQuery<TimetableResponse>(
    range.key,
    personal ? range.path : null,
    {
      fallbackData: seeded ? (initial.data ?? undefined) : undefined,
      fallbackSavedAt: seeded ? initial.savedAt : undefined,
      revalidateOnMount: !seeded,
    }
  );

  const all = useMemo(() => (personal ? (data?.items ?? []) : []), [personal, data]);
  const { subject, teacher } = urlState;
  const filtered = subject !== null || teacher !== null;
  const sessions = useMemo(
    () => all.filter((s) => (!subject || s.subject?.id === subject) && (!teacher || s.teacher?.id === teacher)),
    [all, subject, teacher]
  );
  const resetFilters = filtered ? (
    <Button variant="outline" className="rounded-full" onClick={() => onNavigate({ subject: null, teacher: null }, { replace: true })}>
      {tActions("resetFilters")}
    </Button>
  ) : undefined;

  if (personal && isLoading) return <SkeletonList rows={4} label={tStates("loading")} />;

  if (personal && !data) {
    const offline = !online || error?.isNetworkError || error?.code === "OFFLINE";
    return (
      <EmptyState
        icon={offline ? CloudOff : RefreshCw}
        title={offline ? t("offline.notSaved") : t("loadError")}
        description={offline ? t("offline.notSavedHint") : error ? errors.message(error) : undefined}
        action={
          offline ? undefined : (
            <Button variant="outline" className="rounded-full" onClick={() => void refresh()} disabled={isValidating}>
              {tActions("tryAgain")}
            </Button>
          )
        }
      />
    );
  }

  if (data?.hint === "NO_GROUP") {
    return <EmptyState icon={UsersRound} title={t("noGroup.title")} description={t("noGroup.description")} />;
  }

  const stale = personal && savedAt !== null && (!online || error !== null);

  return (
    <div className="space-y-5">
      {personal && <Filters sessions={all} subject={subject} teacher={teacher} onChange={(patch) => onNavigate(patch, { replace: true })} />}
      {stale && <p className="text-sm text-muted-foreground">{t("offline.savedCopy", { time: format.dateTime(new Date(savedAt), "dayMonthTime") })}</p>}

      {view === "day" && (
        <DayView sessions={sessions.filter((s) => dateKey(s.startsAt) === date)} now={now} filtered={filtered} emptyAction={resetFilters} />
      )}
      {view === "week" &&
        (sessions.length === 0 ? (
          <NoClasses filtered={filtered} action={resetFilters} />
        ) : (
          <WeekGrid monday={range.from} sessions={sessions} allSessions={all} today={today} now={now} />
        ))}
      {view === "month" && (
        <MonthView
          date={date}
          today={today}
          now={now}
          sessions={sessions}
          filtered={filtered}
          onSelectDate={(day) => onNavigate({ date: day }, { replace: true })}
          emptyAction={resetFilters}
        />
      )}
    </div>
  );
}

/** "Day" / "Week" / "Month" (aria-pressed), "Previous" / "Today" / "Next", and the period as an h2. */
export function PeriodToolbar({
  view,
  periodLabel,
  onView,
  onPrevious,
  onToday,
  onNext,
  views = TIMETABLE_VIEWS,
}: {
  view: View;
  periodLabel: string;
  onView?: (view: View) => void;
  onPrevious: () => void;
  onToday: () => void;
  onNext: () => void;
  views?: readonly View[];
}) {
  const t = useTranslations("timetable");
  return (
    <div className="flex flex-col gap-3 rounded-3xl border bg-card p-3 text-card-foreground sm:p-4 lg:flex-row lg:items-center lg:justify-between">
      {onView && (
        <div role="group" aria-label={t("views.label")} className="inline-flex self-start rounded-full bg-muted p-1">
          {views.map((value) => (
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
      )}

      <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
        <div role="group" aria-label={t("nav.label")} className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="rounded-full" onClick={onPrevious}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{t("nav.previous")}</span>
          </Button>
          <Button variant="outline" className="rounded-full" onClick={onToday}>
            {t("nav.today")}
          </Button>
          <Button variant="outline" size="icon" className="rounded-full" onClick={onNext}>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{t("nav.next")}</span>
          </Button>
        </div>
        <h2 aria-live="polite" className="min-w-0 px-1 text-base font-semibold first-letter:uppercase sm:text-lg">
          {periodLabel}
        </h2>
      </div>
    </div>
  );
}

/**
 * /dashboard/timetable: Day / Week / Month views of the signed-in user's classes, URL state
 * `?view=day|week|month&date=YYYY-MM-DD` (+ `subject`, `teacher` filters), offline-capable.
 *
 * View and date come from the URL (History API, no server round trip); without `view`, phones get
 * the day view and larger screens the week view. Without `date`, today (campus timezone).
 */
export function TimetableView({
  role,
  serverSearch,
  serverNow,
  narrowGuess,
  initial,
}: {
  role: Role;
  /** Query string the server rendered (used during hydration). */
  serverSearch: string;
  /** When the server rendered (ms). */
  serverNow: number;
  /** Server's guess of a phone screen (user agent), used during hydration when `view` is absent. */
  narrowGuess: boolean;
  initial: InitialTimetable | null;
}) {
  const t = useTranslations("timetable");
  const format = useFormatter();
  const weekLabel = useWeekLabel();
  const [feedback, setFeedback] = useFeedback();
  const exporter = useCalendarExport(setFeedback);
  const search = useLocationSearch(serverSearch);
  const urlState = useMemo(() => parseTimetableParams(new URLSearchParams(search)), [search]);
  const narrow = useMediaQuery(NARROW_QUERY, narrowGuess);
  const now = useNow(serverNow);
  const today = dateKey(now);
  const view: View = urlState.view ?? (narrow ? "day" : "week");
  const date = urlState.date ?? today;
  const range = myTimetableRange(view, date);
  const personal = role === "STUDENT" || role === "TEACHER";

  const navigate = (patch: Partial<TimetableUrlState>, options: { replace?: boolean } = {}) => {
    setSearch(timetableQuery({ ...urlState, view, date, ...patch }), options);
  };

  const periodLabel =
    view === "day"
      ? format.dateTime(dayToDate(date), "weekdayLong")
      : view === "week"
        ? weekLabel(range.from)
        : format.dateTime(dayToDate(date), { month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")} actions={personal ? <ExportMenu exporter={exporter} /> : undefined} />

      <InlineFeedback feedback={feedback} />
      <CalendarLinkPanel exporter={exporter} />

      {role === "ADMIN" ? (
        <EmptyState
          icon={CalendarCog}
          title={t("adminInfo.title")}
          description={t("adminInfo.description")}
          action={
            <Button asChild className="rounded-full">
              <Link href="/dashboard/admin/timetable">{t("adminInfo.link")}</Link>
            </Button>
          }
        />
      ) : (
        <>
          <PeriodToolbar
            view={view}
            periodLabel={periodLabel}
            onView={(value) => navigate({ view: value })}
            onPrevious={() => navigate({ date: shiftDate(view, date, -1) })}
            onToday={() => navigate({ date: today })}
            onNext={() => navigate({ date: shiftDate(view, date, 1) })}
          />
          <PeriodContent
            key={range.id}
            range={range}
            view={view}
            date={date}
            today={today}
            now={now}
            urlState={urlState}
            personal={personal}
            initial={initial}
            onNavigate={navigate}
          />
        </>
      )}
    </div>
  );
}
