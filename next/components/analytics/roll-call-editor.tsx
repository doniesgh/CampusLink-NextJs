"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "@/components/ui/app-link";
import { ArrowLeft, CheckCheck, Loader2, MessageSquareText, Save, UsersRound, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { SubjectLabel } from "@/components/analytics/level-badge";
import { useAnalyticsFormat } from "@/components/analytics/use-analytics-format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageFeedback } from "@/components/analytics/page-feedback";
import { useFeedback } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { useOnlineStatus } from "@/lib/offline";
import { ATTENDANCE_HREF } from "@/lib/analytics/paths";
import {
  ATTENDANCE_STATUSES,
  TEACHER_STATUSES,
  personName,
  type AttendanceStatus,
  type RollCall,
  type RollCallChange,
  type RosterEntry,
} from "@/lib/analytics/types";
import { formatTimeRange } from "@/lib/datetime";
import type { ActionState } from "@/lib/server-api";
import { cn } from "@/lib/utils";

type Mark = { status: AttendanceStatus | null; note: string };
type SaveAction = (sessionId: string, records: RollCallChange[]) => Promise<ActionState<RollCall>>;

const CHECKED: Record<AttendanceStatus, string> = {
  PRESENT: "peer-checked:border-success peer-checked:bg-success peer-checked:text-success-foreground",
  ABSENT: "peer-checked:border-destructive peer-checked:bg-destructive peer-checked:text-destructive-foreground",
  LATE: "peer-checked:border-highlight peer-checked:bg-highlight peer-checked:text-highlight-foreground",
  EXCUSED: "peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground",
};

function marksOf(rollCall: RollCall): Record<string, Mark> {
  return Object.fromEntries(rollCall.roster.map((entry) => [entry.student.id, { status: entry.status, note: entry.note ?? "" }]));
}

/** Changed rows (`note` only when it changed, so the backend keeps the current one otherwise). */
function diff(roster: RosterEntry[], draft: Record<string, Mark>): RollCallChange[] {
  const changes: RollCallChange[] = [];
  for (const entry of roster) {
    const mark = draft[entry.student.id];
    if (!mark) continue;
    const note = mark.note.trim();
    const statusChanged = mark.status !== entry.status;
    const noteChanged = mark.status !== null && note !== (entry.note ?? "");
    if (!statusChanged && !noteChanged) continue;
    changes.push(noteChanged ? { student: entry.student.id, status: mark.status, note } : { student: entry.student.id, status: mark.status });
  }
  return changes;
}

function StudentRow({
  entry,
  mark,
  statuses,
  disabled,
  locked,
  showGroup,
  onChange,
}: {
  entry: RosterEntry;
  mark: Mark;
  statuses: readonly AttendanceStatus[];
  disabled: boolean;
  /** Teacher looking at an absence excused by the administration. */
  locked: boolean;
  showGroup: boolean;
  onChange: (mark: Mark) => void;
}) {
  const t = useTranslations("analytics.attendance.rollCall");
  const tStatus = useTranslations("analytics.statuses");
  const name = personName(entry.student);
  const [noteOpen, setNoteOpen] = useState(mark.note !== "");
  const id = entry.student.id;
  const visibleStatuses = locked ? (["EXCUSED"] as const) : statuses;

  return (
    <li className="px-4 py-3" data-student-id={id} data-status={mark.status ?? "NONE"}>
      <fieldset disabled={disabled || locked} aria-labelledby={`name-${id}`} className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 font-medium text-foreground">
            <span id={`name-${id}`}>{name}</span>
            {showGroup && entry.student.group?.name && <span className="ml-2 text-xs font-normal text-muted-foreground">{entry.student.group.name}</span>}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {visibleStatuses.map((status) => {
              const inputId = `mark-${id}-${status}`;
              return (
                <div key={status} className="relative">
                  <input
                    id={inputId}
                    type="radio"
                    name={`mark-${id}`}
                    value={status}
                    checked={mark.status === status}
                    onChange={() => onChange({ ...mark, status })}
                    className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                  />
                  <label
                    htmlFor={inputId}
                    className={cn(
                      "pointer-events-none flex h-9 select-none items-center rounded-full border border-input bg-background px-3 text-sm font-medium text-foreground transition-colors",
                      "peer-hover:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
                      "peer-disabled:opacity-60",
                      CHECKED[status]
                    )}
                  >
                    {tStatus(status)}
                  </label>
                </div>
              );
            })}
            {!locked && mark.status !== null && (
              <Button type="button" variant="ghost" size="sm" className="rounded-full px-2.5" onClick={() => onChange({ status: null, note: "" })}>
                <X className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">{t("clearLabel", { name })}</span>
                <span aria-hidden="true">{t("clear")}</span>
              </Button>
            )}
            {!locked && mark.status !== null && !noteOpen && (
              <Button type="button" variant="ghost" size="sm" className="rounded-full px-2.5" onClick={() => setNoteOpen(true)}>
                <MessageSquareText className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">{t("noteLabel", { name })}</span>
                <span aria-hidden="true">{t("addNote")}</span>
              </Button>
            )}
          </div>
        </div>
        {locked && <p className="text-sm text-muted-foreground">{t("excusedLocked")}</p>}
        {mark.status === null && !locked && <p className="text-xs text-muted-foreground">{tStatus("none")}</p>}
        {noteOpen && mark.status !== null && (
          <div className="flex items-center gap-2">
            <label htmlFor={`note-${id}`} className="sr-only">
              {t("noteLabel", { name })}
            </label>
            <Input
              id={`note-${id}`}
              value={mark.note}
              maxLength={500}
              placeholder={t("notePlaceholder")}
              onChange={(event) => onChange({ ...mark, note: event.target.value })}
              className="h-9"
            />
          </div>
        )}
        {locked && mark.note && <p className="text-sm text-muted-foreground">{mark.note}</p>}
      </fieldset>
    </li>
  );
}

/**
 * Roll call of one session: Present / Absent / Late per student (Excused for administrators), "All present",
 * optional notes, and "Save attendance" (Server Action, changed rows only). Shows the teacher's window
 * (15 min before the start → 7 days after the end) and keeps the draft when saving fails (offline, window closed).
 * `now` = when the server rendered the page (decides "not open yet" vs "closed" for a read-only roll call).
 */
export function RollCallEditor({ initial, saveAction, now }: { initial: RollCall; saveAction: SaveAction; now: number }) {
  const t = useTranslations("analytics.attendance.rollCall");
  const tAttendance = useTranslations("analytics.attendance");
  const tTypes = useTranslations("timetable.session.types");
  const fmt = useAnalyticsFormat();
  const online = useOnlineStatus();
  const [rollCall, setRollCall] = useState(initial);
  const [draft, setDraft] = useState<Record<string, Mark>>(() => marksOf(initial));
  const [feedback, setFeedback] = useFeedback();
  const [pending, startTransition] = useTransition();

  const { session, roster, canExcuse, editable } = rollCall;
  const cancelled = session.status === "CANCELLED";
  const statuses = canExcuse ? ATTENDANCE_STATUSES : TEACHER_STATUSES;
  const changes = useMemo(() => diff(roster, draft), [roster, draft]);
  const multipleGroups = session.groups.length > 1;
  const isLocked = (entry: RosterEntry) => !canExcuse && entry.status === "EXCUSED";

  const counts = useMemo(() => {
    const result = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, none: 0 };
    for (const entry of roster) {
      const status = draft[entry.student.id]?.status ?? null;
      if (status) result[status] += 1;
      else result.none += 1;
    }
    return result;
  }, [roster, draft]);

  // Warn before leaving the page with unsaved marks.
  useEffect(() => {
    if (changes.length === 0) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [changes.length]);

  const setMark = (studentId: string, mark: Mark) => setDraft((current) => ({ ...current, [studentId]: mark }));

  const allPresent = () =>
    setDraft((current) => {
      const next = { ...current };
      for (const entry of roster) {
        const mark = next[entry.student.id] ?? { status: null, note: "" };
        if (mark.status === "EXCUSED" || isLocked(entry)) continue;
        next[entry.student.id] = { ...mark, status: "PRESENT" };
      }
      return next;
    });

  const save = () => {
    if (changes.length === 0) return;
    if (!online) {
      setFeedback({ type: "error", message: t("errors.offline") });
      return;
    }
    startTransition(async () => {
      try {
        const result = await saveAction(session.id, changes);
        if (result.ok && result.data) {
          setRollCall(result.data);
          setDraft(marksOf(result.data));
          setFeedback({ type: "success", message: result.message ?? t("saved", { count: result.data.changed ?? 0 }) });
        } else {
          setFeedback({ type: "error", message: result.message ?? t("errors.offline") });
        }
      } catch {
        // The Server Action could not reach the server (connection lost): the draft stays on the page.
        setFeedback({ type: "error", message: t("errors.offline") });
      }
    });
  };

  const windowText = cancelled
    ? t("cancelled")
    : canExcuse
      ? t("adminAnyTime")
      : editable
        ? t("windowOpen", { date: fmt.dateTime(rollCall.window.closesAt) })
        : new Date(rollCall.window.opensAt).getTime() > now
          ? t("windowNotOpen", { date: fmt.dateTime(rollCall.window.opensAt) })
          : t("windowClosed", { date: fmt.dateTime(rollCall.window.closesAt) });

  return (
    <div className="space-y-6 pb-24 sm:pb-0">
      <Link
        href={ATTENDANCE_HREF}
        className="inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("back")}
      </Link>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="neutral">{tTypes(session.type)}</Badge>
          {cancelled && <Badge variant="danger">{tAttendance("states.cancelled")}</Badge>}
          {!editable && !cancelled && <Badge variant="outline">{t("readOnly")}</Badge>}
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          <SubjectLabel subject={session.subject} />
        </h1>
        <p className="text-muted-foreground">
          {t("when", { date: fmt.weekday(session.startsAt), time: formatTimeRange(session.startsAt, session.endsAt) })}
          {session.groups.length > 0 && <> · {tAttendance("groupsLabel", { groups: session.groups.map((group) => group.name).join(", ") })}</>}
          {" · "}
          {session.room ? tAttendance("roomLabel", { room: session.room.name }) : tAttendance("noRoom")}
          {canExcuse && session.teacher && <> · {t("teacherLabel", { teacher: personName(session.teacher) })}</>}
        </p>
        <p className="text-sm text-muted-foreground" data-testid="roll-call-window">
          {windowText}
        </p>
      </header>

      <PageFeedback feedback={feedback} />

      {roster.length === 0 ? (
        <EmptyState icon={UsersRound} title={t("rosterEmpty")} />
      ) : (
        <section aria-labelledby="roster-title" className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="roster-title" className="text-lg font-semibold text-foreground">
                {t("rosterTitle")} <span className="text-sm font-normal text-muted-foreground">({t("rosterCount", { count: roster.length })})</span>
              </h2>
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {t("summary", { marked: roster.length - counts.none, students: roster.length })} ·{" "}
                {t("countsLine", { present: counts.PRESENT, absent: counts.ABSENT, late: counts.LATE, excused: counts.EXCUSED })}
              </p>
            </div>
            {editable && (
              <Button type="button" variant="outline" className="rounded-full" onClick={allPresent} aria-describedby="all-present-hint">
                <CheckCheck className="h-4 w-4" aria-hidden="true" />
                {t("allPresent")}
              </Button>
            )}
          </div>
          {editable && (
            <p id="all-present-hint" className="text-xs text-muted-foreground">
              {t("allPresentHint")}
            </p>
          )}
          <ul className="divide-y rounded-3xl border bg-card">
            {roster.map((entry) => (
              <StudentRow
                key={entry.student.id}
                entry={entry}
                mark={draft[entry.student.id] ?? { status: null, note: "" }}
                statuses={statuses}
                disabled={!editable || pending}
                locked={isLocked(entry)}
                showGroup={multipleGroups}
                onChange={(mark) => setMark(entry.student.id, mark)}
              />
            ))}
          </ul>
        </section>
      )}

      {editable && roster.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t bg-background/95 px-4 py-3 backdrop-blur sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 sm:justify-end">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {t("unsaved", { count: changes.length })}
            </p>
            <Button type="button" className="rounded-full" onClick={save} disabled={pending || changes.length === 0} aria-busy={pending || undefined}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              {t("save")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
