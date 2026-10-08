"use client";

import { useState } from "react";
import Link from "@/components/ui/app-link";
import { ArrowLeft, Download } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ComparisonState } from "@/components/analytics/comparison-panel";
import { StudentOverview } from "@/components/analytics/student-overview";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { BffError, bffFetch, useOnlineStatus } from "@/lib/offline";
import { FOLLOW_UP_HREF, studentAnalyticsPath, studentReportUrl } from "@/lib/analytics/paths";
import { personName, type StudentAnalytics } from "@/lib/analytics/types";

/**
 * Admin view of one student (/dashboard/admin/analytics/students/<id>): the same overview as the student's own page
 * (neutral wording), the opt-in group comparison (fetched on demand, never stored on the device) and the PDF report
 * in the student's language or a chosen one.
 */
export function StaffStudentView({ data }: { data: StudentAnalytics }) {
  const t = useTranslations("analytics.followUp.student");
  const tStudent = useTranslations("analytics.student");
  const online = useOnlineStatus();
  const [compare, setCompare] = useState(false);
  const [comparison, setComparison] = useState<ComparisonState>({ status: "off" });
  const [reportLocale, setReportLocale] = useState("");
  const studentId = data.student.id;
  const group = data.student.group;

  const onCompareChange = (value: boolean) => {
    setCompare(value);
    if (!value) return;
    if (comparison.status === "ready") return;
    if (!online) {
      setComparison({ status: "offline" });
      return;
    }
    setComparison({ status: "loading" });
    bffFetch<StudentAnalytics>(studentAnalyticsPath(studentId, true))
      .then((result) => setComparison(result?.comparison ? { status: "ready", comparison: result.comparison } : { status: "error" }))
      .catch((error: unknown) =>
        setComparison({ status: error instanceof BffError && error.isNetworkError ? "offline" : "error" })
      );
  };

  return (
    <div className="space-y-6">
      <Link
        href={FOLLOW_UP_HREF}
        className="inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("back")}
      </Link>

      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{personName(data.student)}</h1>
          <p className="text-muted-foreground">
            {group
              ? group.program
                ? tStudent("yearLine", { group: group.name, program: group.program.code, year: data.academicYear })
                : tStudent("yearLineNoProgram", { group: group.name, year: data.academicYear })
              : t("noGroup")}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="space-y-1.5">
            <label htmlFor="report-locale" className="block text-sm font-medium">
              {t("reportLanguage")}
            </label>
            <Select id="report-locale" value={reportLocale} onChange={(event) => setReportLocale(event.target.value)} wrapperClassName="sm:w-52">
              <option value="">{t("studentLanguage")}</option>
              <option value="fr">{t("french")}</option>
              <option value="en">{t("english")}</option>
            </Select>
          </div>
          {online ? (
            <Button asChild variant="highlight" className="rounded-full">
              <a href={studentReportUrl(studentId, reportLocale || undefined)} download data-testid="report-download">
                <Download className="h-4 w-4" aria-hidden="true" />
                {t("report")}
              </a>
            </Button>
          ) : (
            <Button variant="highlight" className="rounded-full" disabled>
              <Download className="h-4 w-4" aria-hidden="true" />
              {t("report")}
            </Button>
          )}
        </div>
      </header>

      <StudentOverview
        data={data}
        audience="staff"
        compare={compare}
        onCompareChange={onCompareChange}
        comparison={compare ? comparison : { status: "off" }}
      />
    </div>
  );
}
