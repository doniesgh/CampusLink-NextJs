"use client";

import { CheckCheck, ExternalLink, Eye, EyeOff, Flag, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDateTimeLabel } from "@/components/announcements/use-format";
import { AuthorLink } from "@/components/forum/author-link";
import { HiddenBadge } from "@/components/forum/badges";
import { ForumText } from "@/components/forum/forum-text";
import { ReasonDialog } from "@/components/forum/reason-dialog";
import Link from "@/components/ui/app-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback, useFeedback, type Feedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { useErrorFormatter } from "@/lib/i18n/client";
import { useOnlineStatus } from "@/lib/offline";
import { answerHref, moderationHref, questionHref } from "@/lib/forum/paths";
import { NOTE_MAX_LENGTH, REASON_MAX_LENGTH, type ForumReport, type ReportStatus } from "@/lib/forum/types";
import { cn } from "@/lib/utils";
import { resolveReportAction, setHiddenAction } from "./actions";

type ActionResult = { ok?: boolean; message?: string };

const TAB =
  "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** One report: the reported content (plain text excerpt), the reason, who reported it, and the moderation actions. */
function ReportCard({ report, onFeedback }: { report: ForumReport; onFeedback: (feedback: Feedback) => void }) {
  const t = useTranslations("forum.moderation");
  const errors = useErrorFormatter();
  const online = useOnlineStatus();
  const dateLabel = useDateTimeLabel();
  const target = report.target;
  const isQuestion = report.targetType === "QUESTION";
  const open = report.status === "OPEN";
  const viewHref = isQuestion ? questionHref(report.questionId) : answerHref(report.questionId, report.targetId);
  const apiTarget = isQuestion ? "questions" : "answers";

  /** Runs a moderation action; returns the error for a dialog, or reports the outcome in the page. */
  const run = async (action: () => Promise<ActionResult>, { inDialog = false } = {}): Promise<string | null> => {
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

  return (
    <article
      className={cn("space-y-3 rounded-2xl border bg-card p-4 text-card-foreground sm:p-5", open && "border-l-4 border-l-highlight")}
      data-report-id={report.id}
      data-status={report.status}
      data-target-type={report.targetType}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{isQuestion ? t("targetQuestion") : t("targetAnswer")}</Badge>
        {target?.hidden && <HiddenBadge />}
        {report.outcome && (
          <Badge variant={report.outcome === "HIDDEN" ? "danger" : "neutral"} data-outcome={report.outcome}>
            {t(`outcome.${report.outcome}`)}
          </Badge>
        )}
      </div>

      {target ? (
        <div className="space-y-1.5">
          <h2 className="break-words text-base font-semibold leading-snug text-foreground">
            {isQuestion ? target.title : t("answerTo", { title: target.title ?? "" })}
          </h2>
          <blockquote className="border-l-2 pl-3">
            <ForumText text={target.excerpt} className="line-clamp-4 text-sm leading-6 text-muted-foreground" />
          </blockquote>
          <p className="flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
            {t("by")} <AuthorLink author={target.author} />
          </p>
        </div>
      ) : (
        <p className="text-sm italic text-muted-foreground">{t("targetGone")}</p>
      )}

      <div className="rounded-xl bg-muted/60 px-3 py-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Flag className="h-3.5 w-3.5" aria-hidden="true" />
          {t("reason")}
        </p>
        <ForumText text={report.reason} className="text-sm leading-6" />
      </div>

      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
        <span>{t("reportedBy")}</span>
        <AuthorLink author={report.reporter} />
        <span aria-hidden="true">·</span>
        <time dateTime={report.createdAt}>{dateLabel(report.createdAt)}</time>
      </p>
      {!open && (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span>{t("resolvedBy")}</span>
            <AuthorLink author={report.resolvedBy} />
            {report.resolvedAt && (
              <>
                <span aria-hidden="true">·</span>
                <time dateTime={report.resolvedAt}>{dateLabel(report.resolvedAt)}</time>
              </>
            )}
          </p>
          {report.note && <p className="whitespace-pre-wrap break-words">{t("note", { note: report.note })}</p>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {target && (
          <Button asChild variant="outline" size="sm" className="rounded-full">
            <Link href={viewHref}>
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              {t("view")}
            </Link>
          </Button>
        )}
        {target &&
          (target.hidden ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              disabled={!online}
              onClick={() => void run(() => setHiddenAction(apiTarget, report.targetId, false, { refreshPage: true }))}
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
              {t("unhide")}
            </Button>
          ) : (
            <ReasonDialog
              trigger={
                <Button type="button" variant="outline" size="sm" className="rounded-full text-destructive hover:text-destructive" disabled={!online}>
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                  {t("hide")}
                </Button>
              }
              title={t(isQuestion ? "hideQuestionTitle" : "hideAnswerTitle")}
              description={t("hideDescription")}
              label={t("hideReason")}
              submitLabel={t("hide")}
              maxLength={REASON_MAX_LENGTH}
              destructive
              onSubmit={(reason) =>
                run(() => setHiddenAction(apiTarget, report.targetId, true, { reason, refreshPage: true }), { inDialog: true })
              }
            />
          ))}
        {open && (
          <ReasonDialog
            trigger={
              <Button type="button" size="sm" className="rounded-full" disabled={!online}>
                <CheckCheck className="h-4 w-4" aria-hidden="true" />
                {t("resolve")}
              </Button>
            }
            title={t("resolveTitle")}
            description={t("resolveDescription")}
            label={t("resolveNote")}
            submitLabel={t("resolve")}
            maxLength={NOTE_MAX_LENGTH}
            onSubmit={(note) => run(() => resolveReportAction(report.id, note), { inDialog: true })}
          />
        )}
      </div>
    </article>
  );
}

/**
 * /dashboard/admin/forum (ADMIN): the reports queue ("Open" / "Resolved", ?status=RESOLVED), each report with
 * "View in the forum", "Hide" / "Unhide" and "Resolve". The Server Actions render the page again.
 */
export function ModerationView({
  status,
  reports,
  openCount,
  loadError,
}: {
  status: ReportStatus;
  reports: ForumReport[];
  openCount: number;
  loadError: string | null;
}) {
  const t = useTranslations("forum");
  const tModeration = useTranslations("forum.moderation");
  const [feedback, setFeedback] = useFeedback();

  const tabs: { status: ReportStatus; label: string; href: string }[] = [
    { status: "OPEN", label: tModeration("open"), href: moderationHref },
    { status: "RESOLVED", label: tModeration("resolved"), href: `${moderationHref}?status=RESOLVED` },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("moderationTitle")} description={t("moderationDescription")} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={tModeration("statusTabs")}>
          <ul className="inline-flex items-center gap-1 rounded-full bg-muted p-1">
            {tabs.map((tab) => (
              <li key={tab.status}>
                <Link
                  href={tab.href}
                  aria-current={tab.status === status ? "page" : undefined}
                  className={cn(
                    TAB,
                    tab.status === status ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tab.label}
                  {tab.status === "OPEN" && openCount > 0 && (
                    <span className="rounded-full bg-highlight px-1.5 text-xs font-semibold text-highlight-foreground">{openCount}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="text-sm text-muted-foreground" data-testid="open-reports">
          {tModeration("openCount", { count: openCount })}
        </p>
      </div>

      <InlineFeedback feedback={feedback} />

      {loadError ? (
        <InlineFeedback feedback={{ type: "error", message: `${tModeration("loadError")} ${loadError}` }} />
      ) : reports.length === 0 ? (
        <EmptyState icon={ShieldCheck} title={status === "OPEN" ? tModeration("emptyOpen") : tModeration("emptyResolved")} />
      ) : (
        <ul className="space-y-3" aria-label={tModeration("listLabel")}>
          {reports.map((report) => (
            <li key={report.id}>
              <ReportCard report={report} onFeedback={setFeedback} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
