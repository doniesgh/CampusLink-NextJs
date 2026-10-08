"use client";

import { useEffect } from "react";
import { BellRing, CheckCheck, CheckCircle2, ExternalLink, FileText, Flag, Inbox, RotateCcw, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { PriceBadge, StatusBadge, SubjectBadge, TypeBadge } from "@/components/marketplace/badges";
import { MarketText } from "@/components/marketplace/market-text";
import { TextDialog } from "@/components/marketplace/text-dialog";
import { extensionLabel, useDateTimeLabel, useFileSize, usePersonName, useValidationMessage } from "@/components/marketplace/use-market-format";
import Link from "@/components/ui/app-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback, useFeedback, type Feedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { useErrorFormatter } from "@/lib/i18n/client";
import { useOnlineStatus } from "@/lib/offline";
import { documentHref, fileHref, moderationHref } from "@/lib/marketplace/paths";
import {
  DECISION_REASON_MAX_LENGTH,
  NOTE_MAX_LENGTH,
  type MarketDocument,
  type MarketReport,
  type ReportStatus,
} from "@/lib/marketplace/types";
import { validateDecisionReason, validateNote } from "@/lib/marketplace/validation";
import { cn } from "@/lib/utils";
import { approveDocumentAction, rejectDocumentAction, resolveReportAction, unpublishDocumentAction } from "./actions";

export type ModerationTab = "queue" | "reports" | "unpublished";

type ActionResult = { ok?: boolean; message?: string };
type Run = (action: () => Promise<ActionResult>, options?: { inDialog?: boolean }) => Promise<string | null>;

const TAB =
  "inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Runs a moderation action; returns the error for a dialog, or reports the outcome in the page. */
function useRunner(onFeedback: (feedback: Feedback) => void): Run {
  const errors = useErrorFormatter();
  return async (action, { inDialog = false } = {}) => {
    try {
      const result = await action();
      if (result.ok) {
        if (result.message) onFeedback({ type: "success", message: result.message });
        return null;
      }
      const message = result.message ?? errors.forCode("GENERIC");
      if (!inDialog) onFeedback({ type: "error", message });
      return message;
    } catch {
      const message = errors.forCode("NETWORK_ERROR");
      if (!inDialog) onFeedback({ type: "error", message });
      return message;
    }
  };
}

/** "Reject" with its required reason (shown to the author). */
function RejectButton({ document, run }: { document: MarketDocument; run: Run }) {
  const t = useTranslations("marketplace.moderation");
  const validationMessage = useValidationMessage();
  const online = useOnlineStatus();
  return (
    <TextDialog
      trigger={
        <Button type="button" variant="outline" size="sm" className="rounded-full text-destructive hover:text-destructive" disabled={!online}>
          <XCircle className="h-4 w-4" aria-hidden="true" />
          {t("reject")}
          <span className="sr-only">: {document.title}</span>
        </Button>
      }
      title={t("rejectTitle")}
      description={t("rejectDescription")}
      label={t("rejectReason")}
      submitLabel={t("rejectSubmit")}
      maxLength={DECISION_REASON_MAX_LENGTH}
      destructive
      validate={(value) => validationMessage(validateDecisionReason(value, true))}
      onSubmit={(reason) => run(() => rejectDocumentAction(document.id, reason, { refreshPage: true }), { inDialog: true })}
    />
  );
}

/** "Unpublish" with its optional reason; resolves the open reports of the document. */
function UnpublishButton({ documentId, title, run, label }: { documentId: string; title: string; run: Run; label?: string }) {
  const t = useTranslations("marketplace.moderation");
  const validationMessage = useValidationMessage();
  const online = useOnlineStatus();
  return (
    <TextDialog
      trigger={
        <Button type="button" variant="outline" size="sm" className="rounded-full text-destructive hover:text-destructive" disabled={!online}>
          <ShieldAlert className="h-4 w-4" aria-hidden="true" />
          {label ?? t("unpublish")}
          <span className="sr-only">: {title}</span>
        </Button>
      }
      title={t("unpublishTitle")}
      description={t("unpublishDescription")}
      label={t("unpublishReason")}
      submitLabel={t("unpublishSubmit")}
      maxLength={DECISION_REASON_MAX_LENGTH}
      destructive
      validate={(value) => validationMessage(validateDecisionReason(value, false))}
      onSubmit={(reason) => run(() => unpublishDocumentAction(documentId, reason, { refreshPage: true }), { inDialog: true })}
    />
  );
}

/** A document of the review queue (or of the unpublished list): what to check, the file, the decisions. */
function DocumentReviewCard({ document, highlighted, run }: { document: MarketDocument; highlighted: boolean; run: Run }) {
  const t = useTranslations("marketplace.moderation");
  const tMarket = useTranslations("marketplace");
  const online = useOnlineStatus();
  const dateLabel = useDateTimeLabel();
  const fileSize = useFileSize();
  const personName = usePersonName();
  const pending = document.status === "PENDING_REVIEW";

  return (
    <article
      id={`document-${document.id}`}
      tabIndex={-1}
      className={cn(
        "space-y-3 rounded-2xl border bg-card p-4 text-card-foreground focus:outline-none sm:p-5",
        pending && "border-l-4 border-l-highlight",
        highlighted && "ring-2 ring-primary"
      )}
      data-document-id={document.id}
      data-status={document.status}
      data-highlighted={highlighted ? "true" : undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        {highlighted && (
          <Badge variant="default">
            <BellRing className="h-3.5 w-3.5" aria-hidden="true" />
            {t("fromNotification")}
          </Badge>
        )}
        <TypeBadge type={document.type} />
        <PriceBadge price={document.price} />
        <SubjectBadge subject={document.subject} />
        {document.level !== null && <Badge variant="outline">{tMarket("levelValue", { level: document.level })}</Badge>}
        {!pending && <StatusBadge status={document.status} />}
      </div>
      <h3 className="break-words text-base font-semibold leading-snug sm:text-lg">
        <Link href={documentHref(document.id)} className="underline-offset-4 hover:underline">
          {document.title}
        </Link>
      </h3>
      <p className="text-sm text-muted-foreground">
        {t("submittedBy", { name: personName(document.author) })}
        <span aria-hidden="true"> · </span>
        <time dateTime={document.updatedAt ?? document.createdAt}>{dateLabel(document.updatedAt ?? document.createdAt)}</time>
        {document.professor && (
          <>
            <span aria-hidden="true"> · </span>
            {tMarket("professorValue", { name: document.professor })}
          </>
        )}
        {document.academicYear && (
          <>
            <span aria-hidden="true"> · </span>
            {document.academicYear}
          </>
        )}
      </p>
      {document.description ? (
        <blockquote className="border-l-2 pl-3">
          <MarketText text={document.description} className="line-clamp-4 text-muted-foreground" />
        </blockquote>
      ) : (
        <p className="text-sm italic text-muted-foreground">{t("noDescription")}</p>
      )}
      {document.status === "UNPUBLISHED" && (
        <div className="rounded-xl bg-muted/60 px-3 py-2 text-sm">
          <span className="font-semibold">{t("unpublishedReason")} </span>
          {document.rejectionReason ? <MarketText text={document.rejectionReason} className="inline" /> : t("noReason")}
        </div>
      )}
      {document.file && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <FileText className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="break-all font-medium">{document.file.filename}</span>
          <span className="text-xs text-muted-foreground">
            {[extensionLabel(document.file.filename), fileSize(document.file.size)].filter(Boolean).join(" · ")}
          </span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm" className="rounded-full">
          <a href={fileHref(document.id)} download>
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            {t("openFile")}
            <span className="sr-only">: {document.title}</span>
          </a>
        </Button>
        {pending && (
          <>
            <Button
              type="button"
              size="sm"
              className="rounded-full"
              disabled={!online}
              onClick={() => void run(() => approveDocumentAction(document.id, { refreshPage: true }))}
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              {t("approve")}
              <span className="sr-only">: {document.title}</span>
            </Button>
            <RejectButton document={document} run={run} />
          </>
        )}
        {document.status === "UNPUBLISHED" && (
          <Button
            type="button"
            size="sm"
            className="rounded-full"
            disabled={!online}
            onClick={() => void run(() => approveDocumentAction(document.id, { refreshPage: true }))}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {t("republish")}
            <span className="sr-only">: {document.title}</span>
          </Button>
        )}
        {document.status === "PUBLISHED" && <UnpublishButton documentId={document.id} title={document.title} run={run} />}
      </div>
    </article>
  );
}

/** One report: the document, the reason, who reported it; "Unpublish document" and "Resolve" while open. */
function ReportCard({ report, run }: { report: MarketReport; run: Run }) {
  const t = useTranslations("marketplace.moderation");
  const validationMessage = useValidationMessage();
  const online = useOnlineStatus();
  const dateLabel = useDateTimeLabel();
  const personName = usePersonName();
  const doc = report.document;
  const open = report.status === "OPEN";

  return (
    <article
      className={cn("space-y-3 rounded-2xl border bg-card p-4 text-card-foreground sm:p-5", open && "border-l-4 border-l-highlight")}
      data-report-id={report.id}
      data-status={report.status}
    >
      <div className="flex flex-wrap items-center gap-2">
        {doc && <StatusBadge status={doc.status} />}
        {doc && <PriceBadge price={doc.price} />}
        {report.outcome && (
          <Badge variant={report.outcome === "UNPUBLISHED" ? "danger" : "neutral"} data-outcome={report.outcome}>
            {t(`outcome.${report.outcome}`)}
          </Badge>
        )}
      </div>
      {doc ? (
        <div className="space-y-1">
          <h3 className="break-words text-base font-semibold leading-snug">
            <Link href={documentHref(doc.id)} className="underline-offset-4 hover:underline">
              {doc.title}
            </Link>
          </h3>
          <p className="text-sm text-muted-foreground">{t("by", { name: personName(doc.author) })}</p>
        </div>
      ) : (
        <p className="text-sm italic text-muted-foreground">{t("documentGone")}</p>
      )}
      <div className="rounded-xl bg-muted/60 px-3 py-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Flag className="h-3.5 w-3.5" aria-hidden="true" />
          {t("reason")}
        </p>
        <MarketText text={report.reason} />
      </div>
      <p className="text-xs text-muted-foreground">
        {t("reportedBy", { name: personName(report.reporter) })}
        <span aria-hidden="true"> · </span>
        <time dateTime={report.createdAt}>{dateLabel(report.createdAt)}</time>
      </p>
      {!open && (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>
            {t("resolvedBy", { name: personName(report.resolvedBy) })}
            {report.resolvedAt && (
              <>
                <span aria-hidden="true"> · </span>
                <time dateTime={report.resolvedAt}>{dateLabel(report.resolvedAt)}</time>
              </>
            )}
          </p>
          {report.note && <MarketText text={t("note", { note: report.note })} className="text-xs text-muted-foreground" />}
        </div>
      )}
      {open && (
        <div className="flex flex-wrap items-center gap-2">
          {doc?.status === "PUBLISHED" && <UnpublishButton documentId={doc.id} title={doc.title} run={run} label={t("unpublishDocument")} />}
          <TextDialog
            trigger={
              <Button type="button" size="sm" className="rounded-full" disabled={!online}>
                <CheckCheck className="h-4 w-4" aria-hidden="true" />
                {t("resolve")}
              </Button>
            }
            title={t("resolveTitle")}
            description={t("resolveDescription")}
            label={t("resolveNote")}
            submitLabel={t("resolveSubmit")}
            maxLength={NOTE_MAX_LENGTH}
            validate={(value) => validationMessage(validateNote(value))}
            onSubmit={(note) => run(() => resolveReportAction(report.id, note), { inDialog: true })}
          />
        </div>
      )}
    </article>
  );
}

/**
 * /dashboard/admin/marketplace (ADMIN): "To review" (documents waiting for a review, oldest first: open the file,
 * approve, reject with a reason), "Reports" (open / resolved: unpublish the document, resolve with a note) and
 * "Unpublished" (publish again). Server-rendered; the Server Actions render the page again.
 * `?document=<id>` (link of the review-request notification) highlights that document.
 */
export function ModerationView({
  tab,
  reportStatus,
  queue,
  queueTotal,
  reports,
  openReports,
  unpublished,
  notified,
  loadError,
}: {
  tab: ModerationTab;
  reportStatus: ReportStatus;
  queue: MarketDocument[];
  queueTotal: number;
  reports: MarketReport[];
  openReports: number;
  unpublished: MarketDocument[];
  /** Document of the notification link, when it is not in the list shown (already decided, other page). */
  notified: { id: string; document: MarketDocument | null } | null;
  loadError: string | null;
}) {
  const t = useTranslations("marketplace");
  const tModeration = useTranslations("marketplace.moderation");
  const [feedback, setFeedback] = useFeedback();
  const run = useRunner(setFeedback);
  const highlightId = notified?.id ?? null;

  // Notification link: bring the document into view.
  useEffect(() => {
    if (!highlightId) return;
    const element = window.document.getElementById(`document-${highlightId}`);
    if (element) {
      element.scrollIntoView({ block: "center" });
      element.focus({ preventScroll: true });
    }
  }, [highlightId]);

  const tabs: { key: ModerationTab; label: string; href: string; count?: number }[] = [
    { key: "queue", label: tModeration("tabs.queue"), href: moderationHref, count: queueTotal },
    { key: "reports", label: tModeration("tabs.reports"), href: `${moderationHref}?tab=reports`, count: openReports },
    { key: "unpublished", label: tModeration("tabs.unpublished"), href: `${moderationHref}?tab=unpublished` },
  ];
  const notifiedOutside = notified && !queue.some((doc) => doc.id === notified.id);

  return (
    <div className="space-y-6">
      <PageHeader title={t("moderationTitle")} description={t("moderationDescription")} />

      <nav aria-label={tModeration("tabs.label")} className="max-w-full overflow-x-auto">
        <ul className="inline-flex items-center gap-1 rounded-full bg-muted p-1">
          {tabs.map((entry) => (
            <li key={entry.key}>
              <Link
                href={entry.href}
                aria-current={entry.key === tab ? "page" : undefined}
                className={cn(TAB, entry.key === tab ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                {entry.label}
                {entry.count !== undefined && entry.count > 0 && (
                  <span className="rounded-full bg-highlight px-1.5 text-xs font-semibold text-highlight-foreground" data-testid={`count-${entry.key}`}>
                    {entry.count}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <InlineFeedback feedback={feedback} />
      {loadError && <InlineFeedback feedback={{ type: "error", message: `${tModeration("loadError")} ${loadError}` }} />}

      {tab === "queue" && (
        <section aria-labelledby="queue-title" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="queue-title" className="text-lg font-semibold">
              {tModeration("queueTitle")}
            </h2>
            <p className="text-sm text-muted-foreground" data-testid="queue-count">
              {tModeration("queueCount", { count: queueTotal })}
            </p>
          </div>
          {notifiedOutside && (
            <div className="space-y-2" data-testid="notified-document">
              {notified.document ? (
                <>
                  {notified.document.status !== "PENDING_REVIEW" && (
                    <p className="text-sm text-muted-foreground">
                      {tModeration("alreadyHandled", { status: t(`status.${notified.document.status}`) })}
                    </p>
                  )}
                  <DocumentReviewCard document={notified.document} highlighted run={run} />
                </>
              ) : (
                <p className="rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground">{tModeration("notifiedGone")}</p>
              )}
            </div>
          )}
          {!loadError && queue.length === 0 ? (
            <EmptyState icon={ShieldCheck} title={tModeration("queueEmpty")} description={tModeration("queueEmptyText")} />
          ) : (
            <ul className="space-y-3" aria-label={tModeration("queueTitle")}>
              {queue.map((doc) => (
                <li key={doc.id}>
                  <DocumentReviewCard document={doc} highlighted={doc.id === highlightId} run={run} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "reports" && (
        <section aria-labelledby="reports-title" className="space-y-4">
          <h2 id="reports-title" className="sr-only">
            {tModeration("tabs.reports")}
          </h2>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav aria-label={tModeration("reportStatus")}>
              <ul className="inline-flex items-center gap-1 rounded-full border p-1">
                {(["OPEN", "RESOLVED"] as const).map((status) => (
                  <li key={status}>
                    <Link
                      href={status === "OPEN" ? `${moderationHref}?tab=reports` : `${moderationHref}?tab=reports&status=RESOLVED`}
                      aria-current={status === reportStatus ? "page" : undefined}
                      className={cn(
                        TAB,
                        "py-1",
                        status === reportStatus ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {tModeration(status === "OPEN" ? "open" : "resolved")}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <p className="text-sm text-muted-foreground" data-testid="open-reports">
              {tModeration("openCount", { count: openReports })}
            </p>
          </div>
          {!loadError && reports.length === 0 ? (
            <EmptyState
              icon={reportStatus === "OPEN" ? ShieldCheck : Inbox}
              title={reportStatus === "OPEN" ? tModeration("reportsEmpty") : tModeration("resolvedEmpty")}
            />
          ) : (
            <ul className="space-y-3" aria-label={tModeration("reportsLabel")}>
              {reports.map((report) => (
                <li key={report.id}>
                  <ReportCard report={report} run={run} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "unpublished" && (
        <section aria-labelledby="unpublished-title" className="space-y-3">
          <h2 id="unpublished-title" className="text-lg font-semibold">
            {tModeration("unpublishedTitle")}
          </h2>
          {!loadError && unpublished.length === 0 ? (
            <EmptyState icon={ShieldCheck} title={tModeration("unpublishedEmpty")} />
          ) : (
            <ul className="space-y-3" aria-label={tModeration("unpublishedTitle")}>
              {unpublished.map((doc) => (
                <li key={doc.id}>
                  <DocumentReviewCard document={doc} highlighted={false} run={run} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
