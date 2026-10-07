"use client";

import { useId } from "react";
import { ArrowRightLeft, Ban, CalendarClock, Clock, MapPin, UserRound, Users } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { dateKey, formatTimeRange } from "@/lib/datetime";
import { teacherName, type ClassSession, type SessionType } from "@/lib/timetable/types";
import { cn } from "@/lib/utils";

const TYPE_BADGE: Record<SessionType, BadgeProps["variant"]> = {
  LECTURE: "secondary",
  TUTORIAL: "secondary",
  LAB: "secondary",
  EXAM: "highlight",
  OTHER: "neutral",
};

/** Texts about the last change of a session ("Moved from B12", "Rescheduled, was ..."), or null. */
export function useSessionChange(session: ClassSession) {
  const t = useTranslations("timetable.session");
  const format = useFormatter();
  const cancelled = session.status === "CANCELLED";
  const change = session.change;
  if (cancelled || !change) return { movedFrom: null, rescheduled: null };

  const movedFrom = change.previousRoom?.name ? t("movedFrom", { room: change.previousRoom.name }) : null;
  let rescheduled: string | null = null;
  if (change.previousStartsAt && change.previousEndsAt) {
    const range = formatTimeRange(change.previousStartsAt, change.previousEndsAt);
    const sameDay = dateKey(change.previousStartsAt) === dateKey(session.startsAt);
    const time = sameDay ? range : `${format.dateTime(new Date(change.previousStartsAt), "weekdayDayMonth")}, ${range}`;
    rescheduled = t("rescheduled", { time });
  }
  return { movedFrom, rescheduled };
}

export type SessionCardProps = {
  session: ClassSession;
  /** Heading level of the subject (h3 in lists, h4 under a day heading). */
  headingLevel?: "h3" | "h4";
  /** "compact" for narrow week columns. */
  variant?: "full" | "compact";
  /** Current time (ms) to flag the class in progress; omit to never flag it. */
  now?: number;
  /** Prefix the time with the day (lists that span several days). */
  showDay?: boolean;
  /** Admin: the whole card opens the session (the subject heading becomes a button). */
  onOpen?: (session: ClassSession) => void;
  className?: string;
};

/**
 * One class as an <article> named by its subject: time range ("08:30–10:00"), type, room, teacher,
 * groups and notes, with the "Cancelled" / "Moved from <room>" / "Rescheduled" highlights.
 * The subject colour is only decorative (left bar); every text keeps the theme's contrast.
 */
export function SessionCard({ session, headingLevel = "h3", variant = "full", now, showDay = false, onOpen, className }: SessionCardProps) {
  const t = useTranslations("timetable.session");
  const format = useFormatter();
  const headingId = useId();
  const { movedFrom, rescheduled } = useSessionChange(session);
  const Heading = headingLevel;
  const compact = variant === "compact";
  const cancelled = session.status === "CANCELLED";
  const subjectName = session.subject?.name ?? t("unknownSubject");
  const time = formatTimeRange(session.startsAt, session.endsAt);
  const day = format.dateTime(new Date(session.startsAt), "weekdayDayMonth");
  const start = Date.parse(session.startsAt);
  const inProgress = now !== undefined && !cancelled && start <= now && now < Date.parse(session.endsAt);
  const teacher = teacherName(session.teacher);
  const groups = session.groups.map((group) => group.name).filter(Boolean).join(", ");
  const iconClass = compact ? "h-3.5 w-3.5 shrink-0" : "h-4 w-4 shrink-0";

  return (
    <article
      aria-labelledby={headingId}
      data-session-id={session.id}
      data-status={session.status}
      className={cn(
        "relative flex gap-3 rounded-2xl border bg-card text-card-foreground transition-colors",
        compact ? "p-2.5 pl-3" : "p-4",
        cancelled && "border-dashed bg-muted/50",
        inProgress && "border-success/50 ring-1 ring-success/30",
        onOpen && "cursor-pointer hover:border-primary/40 hover:bg-accent/40 focus-within:ring-2 focus-within:ring-ring",
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn("w-1 shrink-0 self-stretch rounded-full", compact ? "w-1" : "w-1.5", cancelled && "opacity-40")}
        style={{ backgroundColor: session.subject?.color ?? "var(--muted-foreground)" }}
      />
      <div className={cn("min-w-0 flex-1", compact ? "space-y-1" : "space-y-2")}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p
            className={cn(
              "inline-flex items-center gap-1.5 font-semibold tabular-nums",
              compact ? "text-xs" : "text-sm",
              cancelled && "text-muted-foreground line-through decoration-2"
            )}
          >
            <Clock className={iconClass} aria-hidden="true" />
            {showDay ? `${day}, ${time}` : time}
          </p>
          <Badge variant={TYPE_BADGE[session.type] ?? "neutral"} className={cn(compact && "px-2 py-0 text-[11px]")}>
            {t(`types.${session.type}`)}
          </Badge>
          {cancelled && (
            <Badge variant="danger">
              <Ban className="h-3 w-3" aria-hidden="true" />
              {t("cancelled")}
            </Badge>
          )}
          {inProgress && <Badge variant="success">{t("inProgress")}</Badge>}
        </div>

        <Heading id={headingId} className={cn("font-semibold leading-snug", compact ? "text-sm" : "text-base")}>
          {onOpen ? (
            <button
              type="button"
              onClick={() => onOpen(session)}
              className="text-left after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-none"
            >
              {subjectName}
              <span className="sr-only">{`, ${day}, ${time}`}</span>
            </button>
          ) : (
            subjectName
          )}
        </Heading>

        <ul className={cn("grid gap-1 text-muted-foreground", compact ? "text-xs" : "text-sm")}>
          <li className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <MapPin className={iconClass} aria-hidden="true" />
            <span className="sr-only">{t("room")}: </span>
            <span className={cn(session.room && "font-medium text-foreground")}>{session.room?.name ?? t("noRoom")}</span>
            {session.room?.building && !compact && <span>· {session.room.building}</span>}
          </li>
          {movedFrom && (
            <li>
              <Badge variant="warning" className="whitespace-normal">
                <ArrowRightLeft className="h-3 w-3 shrink-0" aria-hidden="true" />
                {movedFrom}
              </Badge>
            </li>
          )}
          {rescheduled && (
            <li>
              <Badge variant="warning" className="whitespace-normal">
                <CalendarClock className="h-3 w-3 shrink-0" aria-hidden="true" />
                {rescheduled}
              </Badge>
            </li>
          )}
          {teacher && (
            <li className="flex items-center gap-1.5">
              <UserRound className={iconClass} aria-hidden="true" />
              <span className="sr-only">{t("teacher")}: </span>
              <span>{teacher}</span>
            </li>
          )}
          {groups && (
            <li className="flex items-center gap-1.5">
              <Users className={iconClass} aria-hidden="true" />
              <span className="sr-only">{t("groups")}: </span>
              <span>{groups}</span>
            </li>
          )}
        </ul>

        {session.notes && !compact && (
          <p className="whitespace-pre-line rounded-xl bg-muted px-3 py-2 text-sm text-foreground">
            <span className="sr-only">{t("notes")}: </span>
            {session.notes}
          </p>
        )}
      </div>
    </article>
  );
}
