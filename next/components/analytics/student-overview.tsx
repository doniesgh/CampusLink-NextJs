"use client";

import { CalendarCheck, Clock, GraduationCap, TriangleAlert, UserX } from "lucide-react";
import { useTranslations } from "next-intl";
import { ActivityChart } from "@/components/analytics/activity-chart";
import { AttendanceBySubject } from "@/components/analytics/attendance-by-subject";
import { ComparisonPanel, ComparisonSwitch, type ComparisonState } from "@/components/analytics/comparison-panel";
import { GradesPanel, type Audience } from "@/components/analytics/grades-panel";
import { LevelBadge } from "@/components/analytics/level-badge";
import { ProgressChart } from "@/components/analytics/progress-chart";
import { StatTile } from "@/components/analytics/stat-tile";
import { useAnalyticsFormat } from "@/components/analytics/use-analytics-format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { StudentAnalytics } from "@/lib/analytics/types";
import { cn } from "@/lib/utils";

/** Warning / alert summary above the figures (only when a subject crossed a threshold). */
function AttendanceCallout({ data, audience }: { data: StudentAnalytics; audience: Audience }) {
  const t = useTranslations("analytics.overview.callout");
  const fmt = useAnalyticsFormat();
  const names = (level: "WARNING" | "CRITICAL") =>
    data.attendance.bySubject.filter((entry) => entry.level === level).map((entry) => entry.subject.name);
  const critical = names("CRITICAL");
  const warning = names("WARNING");
  if (critical.length === 0 && warning.length === 0) return null;
  const level = critical.length > 0 ? "CRITICAL" : "WARNING";

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm",
        level === "CRITICAL" ? "border-destructive/30 bg-destructive/10" : "border-highlight/50 bg-highlight/10"
      )}
      data-callout={level}
    >
      <TriangleAlert className={cn("mt-0.5 h-4 w-4 shrink-0", level === "CRITICAL" ? "text-destructive" : "text-foreground")} aria-hidden="true" />
      <div className="space-y-1 text-foreground">
        {critical.length > 0 && <p className="font-medium">{t(`${audience}.CRITICAL`, { subjects: fmt.list(critical) })}</p>}
        {warning.length > 0 && <p>{t(`${audience}.WARNING`, { subjects: fmt.list(warning) })}</p>}
        <p>
          {t("thresholds", { warning: fmt.percent(data.thresholds.warning), critical: fmt.percent(data.thresholds.critical) })}
        </p>
      </div>
    </div>
  );
}

/**
 * The student view of /api/analytics/me (student page) and /api/analytics/students/:id (admin detail): key figures,
 * attendance per subject with alert levels, grades and averages, progress chart, activity chart and the opt-in
 * group comparison. `audience` picks the wording ("self" speaks to the student with "tu" in French).
 */
export function StudentOverview({
  data,
  audience,
  compare,
  onCompareChange,
  comparison,
}: {
  data: StudentAnalytics;
  audience: Audience;
  compare: boolean;
  onCompareChange: (value: boolean) => void;
  comparison: ComparisonState;
}) {
  const t = useTranslations("analytics.overview");
  const fmt = useAnalyticsFormat();
  const { attendance, grades } = data;
  const held = attendance.heldHours > 0;
  const graded = grades.items.filter((item) => item.score !== null).length;
  const groupAverage =
    comparison.status === "ready" && comparison.comparison.available ? comparison.comparison.grades.overall : null;

  return (
    <div className="space-y-6">
      <AttendanceCallout data={data} audience={audience} />

      <section aria-label={t("figures.label")}>
        <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatTile
            icon={CalendarCheck}
            label={t("figures.attendanceRate")}
            value={held ? fmt.percent(1 - attendance.overallRate) : "—"}
            hint={held ? t("figures.attendanceHint", { absent: fmt.number(attendance.absentHours, 1), held: fmt.number(attendance.heldHours, 1) }) : t("figures.attendanceNone")}
            valueProps={{ "data-figure": "attendance" }}
          >
            {held && (
              <dd className="mt-2">
                <LevelBadge level={attendance.worstLevel} />
              </dd>
            )}
          </StatTile>
          <StatTile
            icon={GraduationCap}
            label={t("figures.overall")}
            value={fmt.grade(grades.overall)}
            hint={t("figures.overallHint", { count: graded })}
            valueProps={{ "data-figure": "overall" }}
          />
          <StatTile
            icon={UserX}
            label={t("figures.absentHours")}
            value={fmt.hours(attendance.absentHours)}
            hint={attendance.excusedHours > 0 ? t("figures.absentHint", { excused: fmt.number(attendance.excusedHours, 1) }) : undefined}
          />
          <StatTile icon={Clock} label={t("figures.late")} value={fmt.number(attendance.lateCount, 0)} hint={t("figures.lateHint")} />
        </dl>
      </section>

      <div className="space-y-3">
        <ComparisonSwitch checked={compare} onCheckedChange={onCompareChange} audience={audience} />
        <ComparisonPanel state={comparison} data={data} audience={audience} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("attendance.title")}</CardTitle>
            <CardDescription>{t(`attendance.description.${audience}`)}</CardDescription>
          </CardHeader>
          <CardContent>
            <AttendanceBySubject subjects={attendance.bySubject} thresholds={data.thresholds} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("progress.title")}</CardTitle>
            <CardDescription>{t(`progress.description.${audience}`)}</CardDescription>
          </CardHeader>
          <CardContent>
            <ProgressChart trend={grades.trend} groupAverage={groupAverage} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("grades.title")}</CardTitle>
          <CardDescription>{t(`grades.description.${audience}`)}</CardDescription>
        </CardHeader>
        <CardContent>
          <GradesPanel grades={grades} audience={audience} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("activity.title")}</CardTitle>
          <CardDescription>{t(`activity.description.${audience}`)}</CardDescription>
        </CardHeader>
        <CardContent>
          <ActivityChart weeks={data.activity.weeks} />
        </CardContent>
      </Card>
    </div>
  );
}
