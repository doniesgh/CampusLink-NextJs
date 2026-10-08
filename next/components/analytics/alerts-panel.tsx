"use client";

import Link from "@/components/ui/app-link";
import { BellOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { LevelBadge, SubjectLabel } from "@/components/analytics/level-badge";
import { UrlSelect, type SelectOption } from "@/components/analytics/url-select";
import { useAnalyticsFormat } from "@/components/analytics/use-analytics-format";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback } from "@/components/ui/feedback";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { studentFollowUpHref } from "@/lib/analytics/paths";
import { personName, type AttendanceAlert } from "@/lib/analytics/types";

/**
 * Absence alerts (ADMIN): filters Group / Level / Subject in the URL, newest first, each student linking to their
 * follow-up page. Pagination is rendered by the server page (`footer`).
 */
export function AlertsPanel({
  alerts,
  total,
  filters,
  groupOptions,
  subjectOptions,
  loadError,
  footer,
}: {
  alerts: AttendanceAlert[];
  total: number;
  filters: { group: string; level: string; subject: string };
  groupOptions: SelectOption[];
  subjectOptions: SelectOption[];
  loadError: string | null;
  footer?: React.ReactNode;
}) {
  const t = useTranslations("analytics.followUp.alerts");
  const tLevels = useTranslations("analytics.levels");
  const fmt = useAnalyticsFormat();
  const query = { group: filters.group || undefined, level: filters.level || undefined, subject: filters.subject || undefined };

  return (
    <section aria-labelledby="alerts-title" className="space-y-5">
      <div>
        <h2 id="alerts-title" className="text-lg font-semibold text-foreground">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      <fieldset className="grid gap-3 sm:grid-cols-3 lg:max-w-3xl">
        <legend className="sr-only">{t("title")}</legend>
        <UrlSelect id="alerts-group" label={t("group")} param="group" value={filters.group} options={groupOptions} allLabel={t("allGroups")} query={query} />
        <UrlSelect
          id="alerts-level"
          label={t("level")}
          param="level"
          value={filters.level}
          options={[
            { value: "WARNING", label: tLevels("WARNING") },
            { value: "CRITICAL", label: tLevels("CRITICAL") },
          ]}
          allLabel={t("allLevels")}
          query={query}
        />
        <UrlSelect id="alerts-subject" label={t("subject")} param="subject" value={filters.subject} options={subjectOptions} allLabel={t("allSubjects")} query={query} />
      </fieldset>

      {loadError ? (
        <InlineFeedback feedback={{ type: "error", message: loadError }} />
      ) : alerts.length === 0 ? (
        <EmptyState icon={BellOff} title={t("empty")} headingLevel="h3" />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t("total", { count: total })}</p>
          <Table>
            <caption className="sr-only">{t("tableCaption")}</caption>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.student")}</TableHead>
                <TableHead>{t("columns.level")}</TableHead>
                <TableHead>{t("columns.subject")}</TableHead>
                <TableHead className="text-right">{t("columns.rate")}</TableHead>
                <TableHead>{t("columns.group")}</TableHead>
                <TableHead>{t("columns.date")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {alerts.map((alert) => (
                <TableRow key={alert.id} data-alert-id={alert.id} data-level={alert.level}>
                  <TableCell className="whitespace-nowrap font-medium">
                    {alert.student ? (
                      <Link href={studentFollowUpHref(alert.student.id)} className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {personName(alert.student)}
                      </Link>
                    ) : (
                      t("unknownStudent")
                    )}
                  </TableCell>
                  <TableCell>
                    <LevelBadge level={alert.level} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <SubjectLabel subject={alert.subject} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmt.percent(alert.rate)}</TableCell>
                  <TableCell className="whitespace-nowrap">{alert.student?.group?.name ?? t("noGroup")}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{fmt.day(alert.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {footer}
        </>
      )}
    </section>
  );
}
