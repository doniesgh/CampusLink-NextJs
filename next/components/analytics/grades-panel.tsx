"use client";

import { useTranslations } from "next-intl";
import { SubjectLabel } from "@/components/analytics/level-badge";
import { useAnalyticsFormat } from "@/components/analytics/use-analytics-format";
import { Badge } from "@/components/ui/badge";
import type { GradesSummary } from "@/lib/analytics/types";

export type Audience = "self" | "staff";

/** Averages by subject (with a meter out of 20) and the list of published assessments with the student's score. */
export function GradesPanel({ grades, audience }: { grades: GradesSummary; audience: Audience }) {
  const t = useTranslations("analytics.overview.grades");
  const tTypes = useTranslations("analytics.assessmentTypes");
  const fmt = useAnalyticsFormat();

  if (grades.items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t(`empty.${audience}`)}</p>;
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="grades-by-subject" className="space-y-3">
        <h3 id="grades-by-subject" className="text-sm font-semibold text-foreground">
          {t("bySubject")}
        </h3>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {grades.bySubject.map((entry) => (
            <li key={entry.subject?.id ?? "none"} className="rounded-2xl border bg-background p-4" data-subject={entry.subject?.code}>
              <SubjectLabel subject={entry.subject} className="text-sm font-medium text-foreground" />
              <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                {entry.average === null ? <span className="text-base font-medium text-muted-foreground">{t("noAverage")}</span> : fmt.grade(entry.average)}
              </p>
              {entry.average !== null && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (entry.average / 20) * 100)}%` }} />
                </div>
              )}
              <p className="mt-2 text-xs text-muted-foreground">{t("subjectAssessments", { count: entry.assessments })}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="grades-list" className="space-y-3">
        <h3 id="grades-list" className="text-sm font-semibold text-foreground">
          {t("list")}
        </h3>
        <div className="overflow-x-auto rounded-2xl border bg-background">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t("tableCaption")}</caption>
            <thead className="bg-muted/60">
              <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-2.5 font-semibold">
                  {t("columns.assessment")}
                </th>
                <th scope="col" className="hidden px-4 py-2.5 font-semibold md:table-cell">
                  {t("columns.date")}
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                  {t("columns.score")}
                </th>
                <th scope="col" className="hidden px-4 py-2.5 text-right font-semibold sm:table-cell">
                  {t("columns.on20")}
                </th>
                <th scope="col" className="hidden px-4 py-2.5 text-right font-semibold sm:table-cell">
                  {t("columns.coefficient")}
                </th>
              </tr>
            </thead>
            <tbody>
              {grades.items.map((item) => (
                <tr key={item.id} className="border-b align-top last:border-0" data-assessment-id={item.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{item.title}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <SubjectLabel subject={item.subject} />
                      <Badge variant="neutral">{tTypes(item.type)}</Badge>
                      <span className="md:hidden">{fmt.day(item.date)}</span>
                    </p>
                    {item.comment && <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{t("comment", { comment: item.comment })}</p>}
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-3 text-muted-foreground md:table-cell">{fmt.longDay(item.date)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-foreground">
                    {item.score === null ? <span className="font-normal text-muted-foreground">{t("notGraded")}</span> : fmt.score(item.score, item.maxScore)}
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-3 text-right tabular-nums sm:table-cell">
                    {item.scoreOn20 === null ? "—" : fmt.number(item.scoreOn20)}
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-3 text-right tabular-nums sm:table-cell">{fmt.number(item.coefficient)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
