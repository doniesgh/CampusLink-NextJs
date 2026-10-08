import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { toApiError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverApi } from "@/lib/server-api";
import { ADMIN_PAGE_SIZE, documentPath, moderationHref, queuePath, reportsPath, unpublishedPath } from "@/lib/marketplace/paths";
import {
  isDocumentList,
  isMarketDocument,
  isObjectId,
  type DocumentList,
  type MarketDocument,
  type ReportList,
  type ReportStatus,
} from "@/lib/marketplace/types";
import { ModerationView, type ModerationTab } from "./moderation-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketplace");
  return { title: t("moderationMetaTitle") };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => ((Array.isArray(value) ? value[0] : value) ?? "").trim();
const TABS: readonly ModerationTab[] = ["queue", "reports", "unpublished"];

/** Only the count of a list (one item fetched). */
const countPath = (path: string) => path.replace(/limit=\d+/, "limit=1").replace(/page=\d+/, "page=1");

/**
 * Marketplace moderation (ADMIN; other roles are sent to /dashboard): review queue, reports and unpublished
 * documents, rendered on the server (never saved for offline use). `?document=<id>` comes from the review-request
 * notification.
 */
export default async function MarketplaceModerationPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const [{ user, error }, t, errors, params] = await Promise.all([
    requireRole(["ADMIN"], moderationHref),
    getTranslations("marketplace"),
    getErrorFormatter(),
    searchParams,
  ]);

  if (!user) {
    return (
      <div className="container max-w-4xl space-y-6 py-6 sm:py-10">
        <PageHeader title={t("moderationTitle")} description={t("moderationDescription")} />
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  const requestedTab = first(params.tab).toLowerCase() as ModerationTab;
  const notifiedId = isObjectId(first(params.document)) ? first(params.document) : null;
  const tab: ModerationTab = TABS.includes(requestedTab) ? requestedTab : "queue";
  const reportStatus: ReportStatus = first(params.status).toUpperCase() === "RESOLVED" ? "RESOLVED" : "OPEN";
  const page = Math.max(1, Number.parseInt(first(params.page), 10) || 1);

  let loadError: string | null = null;
  const load = async <T,>(path: string): Promise<T | null> => {
    try {
      return await serverApi<T>(path);
    } catch (e) {
      loadError ??= errors.message(toApiError(e));
      return null;
    }
  };

  const [queue, reports, unpublished, notifiedDocument] = await Promise.all([
    load<DocumentList>(tab === "queue" ? queuePath(page) : countPath(queuePath(1))),
    load<ReportList>(tab === "reports" ? reportsPath(reportStatus, page) : countPath(reportsPath("OPEN", 1))),
    tab === "unpublished" ? load<DocumentList>(unpublishedPath(page)) : Promise.resolve(null),
    notifiedId && tab === "queue"
      ? serverApi<MarketDocument>(documentPath(notifiedId)).catch(() => null)
      : Promise.resolve(null),
  ]);

  const queueItems = tab === "queue" && isDocumentList(queue) ? queue.items : [];
  const reportItems = tab === "reports" && reports && Array.isArray(reports.items) ? reports.items : [];
  const unpublishedItems = isDocumentList(unpublished) ? unpublished.items : [];
  const active = tab === "queue" ? queue : tab === "reports" ? reports : unpublished;
  const query: Record<string, string | undefined> =
    tab === "queue"
      ? {}
      : tab === "reports"
        ? { tab: "reports", status: reportStatus === "RESOLVED" ? "RESOLVED" : undefined }
        : { tab: "unpublished" };

  return (
    <div className="container max-w-4xl space-y-6 py-6 sm:py-10">
      <ModerationView
        tab={tab}
        reportStatus={reportStatus}
        queue={queueItems}
        queueTotal={isDocumentList(queue) ? (queue.total ?? 0) : 0}
        reports={reportItems}
        openReports={reports?.openCount ?? 0}
        unpublished={unpublishedItems}
        notified={notifiedId ? { id: notifiedId, document: isMarketDocument(notifiedDocument) ? notifiedDocument : null } : null}
        loadError={loadError}
      />
      {active && (
        <Pagination
          pathname={moderationHref}
          searchParams={query}
          page={active.page ?? page}
          limit={active.limit ?? ADMIN_PAGE_SIZE}
          total={active.total ?? 0}
        />
      )}
    </div>
  );
}
