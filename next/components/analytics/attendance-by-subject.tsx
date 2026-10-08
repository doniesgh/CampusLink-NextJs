"use client";

import { useTranslations } from "next-intl";
import { LevelBadge, SubjectLabel } from "@/components/analytics/level-badge";
import { useAnalyticsFormat } from "@/components/analytics/use-analytics-format";
import type { Level, SubjectAttendance, Thresholds } from "@/lib/analytics/types";
import { cn } from "@/lib/utils";

const FILL: Record<Level, string> = { OK: "bg-success", WARNING: "bg-highlight", CRITICAL: "bg-destructive" };

/** Upper bound of the shared meter scale: at least twice the alert threshold, rounded up to 10 %. */
function scaleMax(subjects: SubjectAttendance[], thresholds: Thresholds): number {
  const top = Math.max(thresholds.critical * 2, ...subjects.map((entry) => entry.rate), 0.1);
  return Math.min(1, Math.ceil(top * 10) / 10);
}

/**
 * Absence rate per subject: a meter on a shared scale with the warning/alert marks, the level (icon + text) and
 * the hours in words. Every value is written out, so nothing depends on the bar colours.
 */
export function AttendanceBySubject({ subjects, thresholds }: { subjects: SubjectAttendance[]; thresholds: Thresholds }) {
  const t = useTranslations("analytics.overview.attendance");
  const tLevels = useTranslations("analytics.levels");
  const fmt = useAnalyticsFormat();

  if (subjects.length === 0) return <p className="text-sm text-muted-foreground">{t("empty")}</p>;

  const max = scaleMax(subjects, thresholds);
  const position = (rate: number) => `${Math.min(100, (rate / max) * 100)}%`;

  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-2xl border bg-background">
        {subjects.map((entry) => (
          <li key={entry.subject.id} className="space-y-2 px-4 py-3" data-subject={entry.subject.code} data-level={entry.level}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SubjectLabel subject={entry.subject} className="font-medium text-foreground" />
              <LevelBadge level={entry.level} />
            </div>
            <div
              role="meter"
              aria-label={t("meterLabel", { subject: entry.subject.name })}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(entry.rate * 1000) / 10}
              aria-valuetext={t("meterValue", { rate: fmt.percent(entry.rate), level: tLevels(entry.level) })}
              className="relative h-2.5 rounded-full bg-muted"
            >
              {entry.rate > 0 && (
                <div className={cn("h-full rounded-full", FILL[entry.level])} style={{ width: position(entry.rate) }} />
              )}
              {[thresholds.warning, thresholds.critical].map((mark) => (
                <span
                  key={mark}
                  aria-hidden="true"
                  className="absolute -top-1 h-[18px] w-0.5 -translate-x-1/2 rounded-full bg-foreground/50"
                  style={{ left: position(mark) }}
                />
              ))}
            </div>
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{t("absenceRate", { rate: fmt.percent(entry.rate) })}</span>
              <span>{t("detail", { absent: fmt.number(entry.absentHours, 1), held: fmt.number(entry.heldHours, 1) })}</span>
              {entry.excusedHours > 0 && <span>{t("excused", { hours: fmt.number(entry.excusedHours, 1) })}</span>}
              {entry.lateCount > 0 && <span>{t("late", { count: entry.lateCount })}</span>}
            </p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {t("thresholdMarks", { warning: fmt.percent(thresholds.warning), critical: fmt.percent(thresholds.critical) })}
      </p>
    </div>
  );
}
