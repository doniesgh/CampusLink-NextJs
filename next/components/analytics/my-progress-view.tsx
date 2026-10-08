"use client";

import { useState } from "react";
import { CloudOff, Download, RefreshCw, UsersRound } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import type { ComparisonState } from "@/components/analytics/comparison-panel";
import { StudentOverview } from "@/components/analytics/student-overview";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonList } from "@/components/ui/skeleton";
import { useErrorFormatter } from "@/lib/i18n/client";
import { useOfflineQuery, useOnlineStatus, type OfflineQueryResult } from "@/lib/offline";
import { myAnalyticsPath, myReportUrl } from "@/lib/analytics/paths";
import type { StudentAnalytics } from "@/lib/analytics/types";

export type InitialAnalytics = { data: StudentAnalytics | null; savedAt: number };

/** State of the opt-in comparison from its query (off while the switch is off). */
export function comparisonState(enabled: boolean, query: Pick<OfflineQueryResult<StudentAnalytics>, "data" | "isLoading" | "error">, online: boolean): ComparisonState {
  if (!enabled) return { status: "off" };
  if (query.data?.comparison) return { status: "ready", comparison: query.data.comparison };
  if (query.isLoading) return { status: "loading" };
  if (!online || query.error?.isNetworkError || query.error?.code === "OFFLINE") return { status: "offline" };
  return query.error ? { status: "error" } : { status: "loading" };
}

/** Header line under the title: group, program and academic year. */
function GroupLine({ data }: { data: StudentAnalytics }) {
  const t = useTranslations("analytics.student");
  const group = data.student.group;
  if (!group) return null;
  return (
    <p className="text-sm text-muted-foreground">
      {group.program
        ? t("yearLine", { group: group.name, program: group.program.code, year: data.academicYear })
        : t("yearLineNoProgram", { group: group.name, year: data.academicYear })}
    </p>
  );
}

/**
 * Student page "My progress" (/dashboard/analytics). Data rendered on the server first, then kept in IndexedDB by
 * useOfflineQuery (readable offline, "Saved copy from …"). The comparison switch is opt-in and loads
 * /analytics/me?compare=true (also saved for offline reading once loaded). The PDF report is a plain download
 * link through the BFF (disabled offline).
 */
export function MyProgressView({ initial }: { initial: InitialAnalytics }) {
  const t = useTranslations("analytics");
  const tStates = useTranslations("common.states");
  const tActions = useTranslations("common.actions");
  const locale = useLocale();
  const format = useFormatter();
  const errors = useErrorFormatter();
  const online = useOnlineStatus();
  const seeded = initial.data !== null;
  const { data, savedAt, isLoading, isValidating, error, refresh } = useOfflineQuery<StudentAnalytics>(["analytics", "me"], myAnalyticsPath(), {
    fallbackData: initial.data ?? undefined,
    fallbackSavedAt: initial.savedAt,
    revalidateOnMount: !seeded,
  });
  const [compare, setCompare] = useState(false);
  const compareQuery = useOfflineQuery<StudentAnalytics>(["analytics", "me", "compare"], compare ? myAnalyticsPath(true) : null, {
    reportLastUpdated: false,
  });

  const reportAction = online ? (
    <Button asChild variant="highlight" className="rounded-full">
      <a href={myReportUrl(locale)} download data-testid="report-download">
        <Download className="h-4 w-4" aria-hidden="true" />
        {t("student.reportButton")}
      </a>
    </Button>
  ) : (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Button variant="highlight" className="rounded-full" disabled aria-describedby="report-offline">
        <Download className="h-4 w-4" aria-hidden="true" />
        {t("student.reportButton")}
      </Button>
      <span id="report-offline" className="text-xs text-muted-foreground">
        {t("student.reportOffline")}
      </span>
    </div>
  );

  const header = <PageHeader title={t("title")} description={t("description")} actions={data ? reportAction : undefined} />;

  if (isLoading) {
    return (
      <div className="space-y-6">
        {header}
        <SkeletonList rows={4} label={tStates("loading")} />
      </div>
    );
  }

  if (!data) {
    const offline = !online || error?.isNetworkError || error?.code === "OFFLINE";
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          icon={offline ? CloudOff : RefreshCw}
          title={offline ? t("offline.notSaved") : t("offline.loadError")}
          description={offline ? t("offline.notSavedHint") : error ? errors.message(error) : undefined}
          action={
            offline ? undefined : (
              <Button variant="outline" className="rounded-full" onClick={() => void refresh()} disabled={isValidating}>
                {tActions("tryAgain")}
              </Button>
            )
          }
        />
      </div>
    );
  }

  const stale = savedAt !== null && (!online || error !== null);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {header}
        <GroupLine data={data} />
        {stale && <p className="text-sm text-muted-foreground">{t("offline.savedCopy", { time: format.dateTime(new Date(savedAt), "dayMonthTime") })}</p>}
      </div>
      {!data.student.group && <EmptyState icon={UsersRound} title={t("student.noGroup")} description={t("student.noGroupHint")} />}
      <StudentOverview
        data={data}
        audience="self"
        compare={compare}
        onCompareChange={setCompare}
        comparison={comparisonState(compare, compareQuery, online)}
      />
    </div>
  );
}
