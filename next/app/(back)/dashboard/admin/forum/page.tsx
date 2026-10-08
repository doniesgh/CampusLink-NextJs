import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { toApiError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverApi } from "@/lib/server-api";
import { moderationHref, reportsPath } from "@/lib/forum/paths";
import type { ReportList, ReportStatus } from "@/lib/forum/types";
import { ModerationView } from "./moderation-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("forum");
  return { title: t("moderationMetaTitle") };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

export default async function ForumModerationPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const [{ user, error }, t, errors] = await Promise.all([
    requireRole(["ADMIN"], moderationHref),
    getTranslations("forum"),
    getErrorFormatter(),
  ]);

  if (!user) {
    return (
      <div className="container max-w-4xl space-y-6 py-6 sm:py-10">
        <PageHeader title={t("moderationTitle")} description={t("moderationDescription")} />
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  const params = await searchParams;
  const status: ReportStatus = first(params.status).toUpperCase() === "RESOLVED" ? "RESOLVED" : "OPEN";
  const page = Math.max(1, Number.parseInt(first(params.page), 10) || 1);

  let list: ReportList | null = null;
  let loadError: string | null = null;
  try {
    list = await serverApi<ReportList>(reportsPath(status, page));
  } catch (e) {
    loadError = errors.message(toApiError(e));
  }
  const reports = Array.isArray(list?.items) ? list.items : [];

  return (
    <div className="container max-w-4xl space-y-6 py-6 sm:py-10">
      <ModerationView status={status} reports={reports} openCount={list?.openCount ?? 0} loadError={loadError} />
      {list && (
        <Pagination
          pathname={moderationHref}
          searchParams={{ status: status === "RESOLVED" ? "RESOLVED" : undefined }}
          page={list.page ?? page}
          limit={list.limit ?? 20}
          total={list.total ?? 0}
        />
      )}
    </div>
  );
}
