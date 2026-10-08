"use client";

import { useMemo, useState } from "react";
import Link from "@/components/ui/app-link";
import { CalendarCheck, GraduationCap, ShieldAlert, UsersRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { LevelBadge } from "@/components/analytics/level-badge";
import { StatTile } from "@/components/analytics/stat-tile";
import { UrlSelect, type SelectOption } from "@/components/analytics/url-select";
import { useAnalyticsFormat } from "@/components/analytics/use-analytics-format";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback } from "@/components/ui/feedback";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { studentFollowUpHref } from "@/lib/analytics/paths";
import { LEVELS, personName, type GroupOverview, type GroupStudentRow } from "@/lib/analytics/types";

type Sort = "name" | "absences" | "average";

function sortRows(rows: GroupStudentRow[], sort: Sort): GroupStudentRow[] {
  if (sort === "name") return rows;
  const copy = [...rows];
  if (sort === "absences") {
    copy.sort(
      (a, b) =>
        LEVELS.indexOf(b.attendance.worstLevel) - LEVELS.indexOf(a.attendance.worstLevel) || b.attendance.rate - a.attendance.rate
    );
  } else {
    // Lowest average first (students who may need help), students without grades last.
    copy.sort((a, b) => (a.grades.average ?? Number.POSITIVE_INFINITY) - (b.grades.average ?? Number.POSITIVE_INFINITY));
  }
  return copy;
}

/**
 * Group overview (ADMIN): group / subject pickers (URL), summary tiles (students, average attendance, average grade,
 * levels) and one row per student (absence rate + worst level, missed hours, late arrivals, published-grade average)
 * linking to the student's follow-up page. Sorting is local.
 */
export function GroupOverviewPanel({
  overview,
  filters,
  groupOptions,
  loadError,
}: {
  overview: GroupOverview | null;
  filters: { group: string; subject: string };
  groupOptions: SelectOption[];
  loadError: string | null;
}) {
  const t = useTranslations("analytics.followUp.groups");
  const fmt = useAnalyticsFormat();
  const [sort, setSort] = useState<Sort>("name");
  const rows = useMemo(() => sortRows(overview?.students ?? [], sort), [overview, sort]);
  const query = { tab: "groups", group: filters.group || undefined, subject: filters.subject || undefined };
  const subjectOptions: SelectOption[] = (overview?.subjects ?? []).map((subject) => ({ value: subject.id, label: subject.name }));

  if (groupOptions.length === 0) return <EmptyState icon={UsersRound} title={t("noGroups")} headingLevel="h2" />;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3 lg:max-w-3xl">
        <UrlSelect id="overview-group" label={t("group")} param="group" value={filters.group} options={groupOptions} query={query} reset={["subject"]} />
        <UrlSelect
          id="overview-subject"
          label={t("subject")}
          param="subject"
          value={filters.subject}
          options={subjectOptions}
          allLabel={t("allSubjects")}
          query={query}
        />
        <div className="space-y-1.5">
          <label htmlFor="overview-sort" className="block text-sm font-medium">
            {t("sort")}
          </label>
          <Select id="overview-sort" value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
            <option value="name">{t("sortName")}</option>
            <option value="absences">{t("sortAbsences")}</option>
            <option value="average">{t("sortAverage")}</option>
          </Select>
        </div>
      </div>

      {loadError && <InlineFeedback feedback={{ type: "error", message: `${t("loadError")} ${loadError}` }} />}

      {overview && (
        <>
          <section aria-label={t("summaryLabel")}>
            <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <StatTile icon={UsersRound} label={t("students")} value={fmt.number(overview.summary.students, 0)} />
              <StatTile icon={CalendarCheck} label={t("averageAttendance")} value={overview.summary.students > 0 ? fmt.percent(1 - overview.summary.averageRate) : "—"} />
              <StatTile icon={GraduationCap} label={t("averageGrade")} value={fmt.grade(overview.summary.averageGrade)} />
              <StatTile
                icon={ShieldAlert}
                label={t("levelsTitle")}
                value={
                  <span className="flex flex-col gap-1.5 text-sm font-normal">
                    {(["CRITICAL", "WARNING", "OK"] as const).map((level) => (
                      <span key={level} className="flex items-center justify-between gap-2" data-level-count={level}>
                        <LevelBadge level={level} />
                        <span className="font-semibold tabular-nums">{fmt.number(overview.summary.levels[level], 0)}</span>
                      </span>
                    ))}
                  </span>
                }
              />
            </dl>
          </section>

          {overview.subjects.length === 0 && <p className="text-sm text-muted-foreground">{t("noSubjects")}</p>}

          {rows.length === 0 ? (
            <EmptyState icon={UsersRound} title={t("empty")} headingLevel="h2" />
          ) : (
            <Table>
              <caption className="sr-only">{t("tableCaption", { group: overview.group?.name ?? "" })}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.student")}</TableHead>
                  <TableHead>{t("columns.level")}</TableHead>
                  <TableHead className="text-right">{t("columns.absences")}</TableHead>
                  <TableHead className="text-right">{t("columns.average")}</TableHead>
                  <TableHead className="text-right">{t("columns.missed")}</TableHead>
                  <TableHead className="text-right">{t("columns.late")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.student.id} data-student-id={row.student.id} data-level={row.attendance.worstLevel}>
                    <TableCell className="whitespace-nowrap font-medium">
                      <Link
                        href={studentFollowUpHref(row.student.id)}
                        className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {personName(row.student)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <LevelBadge level={row.attendance.worstLevel} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.attendance.heldHours > 0 ? fmt.percent(row.attendance.rate) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt.grade(row.grades.average)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt.hours(row.attendance.absentHours)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt.number(row.attendance.lateCount, 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}
