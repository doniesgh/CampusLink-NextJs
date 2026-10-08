"use client";

import { useTranslations } from "next-intl";
import { SubjectLabel } from "@/components/analytics/level-badge";
import type { Audience } from "@/components/analytics/grades-panel";
import { useAnalyticsFormat } from "@/components/analytics/use-analytics-format";
import { Switch } from "@/components/ui/switch";
import type { Comparison, StudentAnalytics } from "@/lib/analytics/types";

/** What the opt-in comparison currently shows. */
export type ComparisonState =
  | { status: "off" }
  | { status: "loading" }
  | { status: "offline" }
  | { status: "error" }
  | { status: "ready"; comparison: Comparison };

/** "Compare with my group" switch (opt-in, off by default) and its explanation. */
export function ComparisonSwitch({
  checked,
  onCheckedChange,
  audience,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  audience: Audience;
}) {
  const t = useTranslations("analytics.overview.comparison");
  return (
    <div className="flex items-start gap-3 rounded-2xl border bg-card px-4 py-3">
      <Switch id="compare-switch" checked={checked} onCheckedChange={onCheckedChange} aria-describedby="compare-hint" className="mt-0.5" />
      <div className="grid gap-0.5">
        <label htmlFor="compare-switch" className="cursor-pointer text-sm font-medium leading-5">
          {audience === "self" ? t("switch") : t("switchStaff")}
        </label>
        <p id="compare-hint" className="text-sm text-muted-foreground">
          {t("hint")}
        </p>
      </div>
    </div>
  );
}

function CompareTable({
  caption,
  rows,
  youLabel,
  groupLabel,
  subjectLabel,
}: {
  caption: string;
  rows: { key: string; label: React.ReactNode; you: string; group: string }[];
  youLabel: string;
  groupLabel: string;
  subjectLabel: string;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border bg-background">
      <table className="w-full text-left text-sm">
        <caption className="px-4 pt-3 text-left text-sm font-semibold text-foreground">{caption}</caption>
        <thead>
          <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="px-4 py-2 font-semibold">
              {subjectLabel}
            </th>
            <th scope="col" className="px-4 py-2 text-right font-semibold">
              {youLabel}
            </th>
            <th scope="col" className="px-4 py-2 text-right font-semibold">
              {groupLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.key} className={index === 0 ? "border-b bg-muted/40 font-semibold" : "border-b last:border-0"}>
              <th scope="row" className="px-4 py-2 font-normal">
                {row.label}
              </th>
              <td className="px-4 py-2 text-right tabular-nums">{row.you}</td>
              <td className="px-4 py-2 text-right tabular-nums">{row.group}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Group averages next to the student's own figures (attendance rate = 1 - absence rate, averages out of 20).
 * Never shows individual data of other students: the API only returns group averages, for groups of 5 or more.
 */
export function ComparisonPanel({ state, data, audience }: { state: ComparisonState; data: StudentAnalytics; audience: Audience }) {
  const t = useTranslations("analytics.overview.comparison");
  const tFigures = useTranslations("analytics.overview.figures");
  const fmt = useAnalyticsFormat();

  if (state.status === "off") return null;
  if (state.status !== "ready") {
    const message = state.status === "loading" ? t("loading") : state.status === "offline" ? t("offline") : t("error");
    return (
      <p className="rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground" aria-busy={state.status === "loading" || undefined}>
        {message}
      </p>
    );
  }

  const { comparison } = state;
  if (!comparison.available) {
    return (
      <p className="rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground" data-comparison="unavailable">
        {t("unavailable", { min: comparison.minGroupSize })}
      </p>
    );
  }

  const presence = (rate: number) => fmt.percent(1 - rate);
  const ownAttendance = new Map(data.attendance.bySubject.map((entry) => [entry.subject.id, entry]));
  const ownGrades = new Map(data.grades.bySubject.map((entry) => [entry.subject?.id ?? "", entry]));
  const hasHeld = data.attendance.heldHours > 0;
  const you = t(`you.${audience}`);

  const attendanceRows = [
    {
      key: "overall",
      label: tFigures("attendanceRate"),
      you: hasHeld ? presence(data.attendance.overallRate) : "—",
      group: presence(comparison.attendance.averageRate),
    },
    ...comparison.attendance.bySubject.map((entry) => {
      const own = ownAttendance.get(entry.subject.id);
      return {
        key: entry.subject.id,
        label: <SubjectLabel subject={entry.subject} />,
        you: own && own.heldHours > 0 ? presence(own.rate) : "—",
        group: presence(entry.averageRate),
      };
    }),
  ];
  const gradeRows = [
    { key: "overall", label: tFigures("overall"), you: fmt.grade(data.grades.overall), group: fmt.grade(comparison.grades.overall) },
    ...comparison.grades.bySubject.map((entry) => ({
      key: entry.subject.id,
      label: <SubjectLabel subject={entry.subject} />,
      you: fmt.grade(ownGrades.get(entry.subject.id)?.average ?? null),
      group: fmt.grade(entry.average),
    })),
  ];

  return (
    <section aria-labelledby="comparison-title" className="space-y-3" data-comparison="available">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="comparison-title" className="text-lg font-semibold text-foreground">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("groupSize", { count: comparison.groupSize })}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <CompareTable caption={t("attendance")} rows={attendanceRows} youLabel={you} groupLabel={t("group")} subjectLabel={t("subject")} />
        <CompareTable caption={t("average")} rows={gradeRows} youLabel={you} groupLabel={t("group")} subjectLabel={t("subject")} />
      </div>
    </section>
  );
}
