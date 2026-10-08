"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CalendarDays, CheckCircle2, CloudOff, Download, Flag, FolderOpen, GraduationCap, Layers, RotateCcw, ShieldAlert, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { PriceBadge, StatusBadge, SubjectBadge, TypeBadge } from "@/components/marketplace/badges";
import { EditDocumentDialog } from "@/components/marketplace/edit-document-dialog";
import { MarketText } from "@/components/marketplace/market-text";
import { PurchasePanel } from "@/components/marketplace/purchase-panel";
import { RatingStars } from "@/components/marketplace/rating-stars";
import { ReviewsSection } from "@/components/marketplace/reviews-section";
import { TextDialog } from "@/components/marketplace/text-dialog";
import { useDateLabel, usePersonName, useValidationMessage } from "@/components/marketplace/use-market-format";
import Link from "@/components/ui/app-link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback, type Feedback } from "@/components/ui/feedback";
import { SkeletonList } from "@/components/ui/skeleton";
import { useErrorFormatter } from "@/lib/i18n/client";
import { invalidateQueries, useOfflineQuery, useOnlineStatus, useQueryClient } from "@/lib/offline";
import { documentKey, documentPath, marketplaceHref, reviewsKey, walletKey } from "@/lib/marketplace/paths";
import { useMarketConfig, useMarketSubjects, useWallet, type Snapshot } from "@/lib/marketplace/queries";
import {
  DECISION_REASON_MAX_LENGTH,
  isMarketDocument,
  REPORT_REASON_MAX_LENGTH,
  type MarketConfig,
  type MarketDocument,
  type PurchaseResult,
  type ReviewList,
  type Wallet,
} from "@/lib/marketplace/types";
import { validateDecisionReason, validateReportReason } from "@/lib/marketplace/validation";
import type { Role, Subject } from "@/lib/types";
import { approveDocumentAction, rejectDocumentAction, unpublishDocumentAction } from "@/app/(back)/dashboard/admin/marketplace/actions";
import { reportDocumentAction } from "@/app/(back)/dashboard/marketplace/actions";

type Anchor = "top" | "reviews";
type Anchored = { anchor: Anchor; value: Feedback } | null;
type ActionResult = { ok?: boolean; message?: string; data?: MarketDocument };

const DOWNLOAD_REFRESH_MS = 1500;
const ACTION_BUTTON = "rounded-full";

function BackLink() {
  const t = useTranslations("marketplace.detail");
  return (
    <Link
      href={marketplaceHref}
      className="inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {t("back")}
    </Link>
  );
}

/** Subject, level, year, professor, author, publication date. */
function Facts({ document }: { document: MarketDocument }) {
  const t = useTranslations("marketplace.detail");
  const tMarket = useTranslations("marketplace");
  const dateLabel = useDateLabel();
  const personName = usePersonName();
  const date = document.publishedAt ?? document.createdAt;
  const rows: { icon: typeof Layers; label: string; value: React.ReactNode }[] = [];
  if (document.level !== null) rows.push({ icon: Layers, label: t("level"), value: tMarket("levelValue", { level: document.level }) });
  if (document.academicYear) rows.push({ icon: CalendarDays, label: t("academicYear"), value: document.academicYear });
  if (document.professor) rows.push({ icon: GraduationCap, label: t("professor"), value: document.professor });
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t("sharedBy", { name: personName(document.author) })}
        <span aria-hidden="true"> · </span>
        <time dateTime={date}>{dateLabel(date)}</time>
      </p>
      {rows.length > 0 && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {rows.map((row) => (
            <div key={row.label} className="flex items-start gap-2 rounded-2xl border bg-card px-3 py-2">
              <row.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">{row.label}</dt>
                <dd className="break-words text-sm font-medium">{row.value}</dd>
              </div>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** Review state of a document that is not published (only its author and ADMINs see it). */
function StatusNotice({ document }: { document: MarketDocument }) {
  const t = useTranslations("marketplace.detail");
  if (document.status === "PUBLISHED") return null;
  const reason = document.rejectionReason;
  return (
    <div className="space-y-1 rounded-2xl border border-dashed bg-muted/40 px-4 py-3 text-sm" data-testid="status-notice">
      <p className="font-medium">{t(`notice.${document.status}`)}</p>
      {(document.status === "REJECTED" || document.status === "UNPUBLISHED") && (
        <div className="text-muted-foreground">
          <span className="font-semibold">{t("reason")} </span>
          {reason ? <MarketText text={reason} className="inline text-muted-foreground" /> : t("noReason")}
        </div>
      )}
      {document.status === "REJECTED" && document.mine && <p className="text-muted-foreground">{t("rejectedHint")}</p>}
    </div>
  );
}

/**
 * /dashboard/marketplace/[id]: type, price, status, h1 = title, facts, description (plain text), "Get this document"
 * (download / buy with confirmation), author tools ("Edit"), "Report", ADMIN moderation (approve, reject, unpublish,
 * publish again) and the reviews.
 */
export function DocumentView({
  id,
  initial,
  initialReviews,
  initialWallet,
  subjects: initialSubjects,
  config: initialConfig,
  currentYear,
  viewer,
}: {
  id: string;
  initial: Snapshot<MarketDocument>;
  initialReviews: Snapshot<ReviewList>;
  initialWallet: Snapshot<Wallet>;
  subjects: Snapshot<Subject[]>;
  config: Snapshot<MarketConfig>;
  currentYear: string;
  viewer: { id: string; role: Role };
}) {
  const t = useTranslations("marketplace.detail");
  const tMarket = useTranslations("marketplace");
  const tReport = useTranslations("marketplace.report");
  const tModeration = useTranslations("marketplace.moderation");
  const tMine = useTranslations("marketplace.mine");
  const errors = useErrorFormatter();
  const validationMessage = useValidationMessage();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const isAdmin = viewer.role === "ADMIN";
  const [feedback, setFeedback] = useState<Anchored>(null);
  const downloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = useOfflineQuery<MarketDocument>(documentKey(id), documentPath(id), {
    fallbackData: initial?.data ?? undefined,
    fallbackSavedAt: initial?.savedAt,
    revalidateOnMount: !initial?.data,
  });
  const wallet = useWallet(initialWallet);
  // Only the author edits the document (form options).
  const mine = isMarketDocument(query.data) && query.data.mine === true;
  const subjects = useMarketSubjects(initialSubjects, mine);
  const config = useMarketConfig(initialConfig, mine);

  useEffect(() => () => {
    if (downloadTimer.current) clearTimeout(downloadTimer.current);
  }, []);

  const report = (anchor: Anchor) => (value: Feedback) => setFeedback({ anchor, value: { ...value, at: value.at ?? Date.now() } });
  const reportTop = report("top");

  if (query.isLoading) return <SkeletonList rows={4} label={t("loading")} />;
  const document = isMarketDocument(query.data) ? query.data : undefined;
  if (!document) {
    const offline = !online || !!query.error?.isNetworkError || query.error?.code === "OFFLINE";
    return (
      <div className="space-y-6">
        <BackLink />
        <h1 className="sr-only">{tMarket("documentMetaTitle")}</h1>
        <EmptyState
          icon={offline ? CloudOff : XCircle}
          headingLevel="h2"
          title={offline ? t("notSavedTitle") : t("loadError")}
          description={offline ? t("notSavedText") : undefined}
        />
      </div>
    );
  }

  const setDocument = (next: MarketDocument) => query.mutate(next);

  /** Runs an action returning a document; returns the error for a dialog, or reports the outcome at the top. */
  const run = async (action: () => Promise<ActionResult>, { inDialog = false } = {}): Promise<string | null> => {
    try {
      const result = await action();
      if (result.ok) {
        if (result.data) setDocument(result.data);
        invalidateQueries("marketplace:list");
        if (result.message) reportTop({ type: "success", message: result.message });
        return null;
      }
      const message = result.message ?? errors.forCode("GENERIC");
      if (!inDialog) reportTop({ type: "error", message });
      void query.refresh();
      return message;
    } catch {
      const message = errors.forCode("NETWORK_ERROR");
      if (!inDialog) reportTop({ type: "error", message });
      return message;
    }
  };

  const onPurchased = (result: PurchaseResult, message: string | undefined) => {
    setDocument(result.document);
    queryClient.setQueryData<Wallet>(walletKey(1), (current) => (current ? { ...current, balance: result.balance } : current));
    invalidateQueries("marketplace:wallet");
    invalidateQueries(reviewsKey(id, 1).join(":"));
    invalidateQueries("marketplace:list");
    invalidateQueries("marketplace:library");
    reportTop({ type: "success", message: message ?? t("bought") });
  };

  const onStale = (message: string) => {
    reportTop({ type: "error", message });
    void query.refresh();
    invalidateQueries("marketplace:wallet");
  };

  // A first download of a free document puts it in the library and allows a review: reload both a moment later.
  const onDownload = () => {
    if (document.purchased || document.mine) return;
    if (downloadTimer.current) clearTimeout(downloadTimer.current);
    downloadTimer.current = setTimeout(() => {
      void query.refresh();
      invalidateQueries(reviewsKey(id, 1).join(":"));
      invalidateQueries("marketplace:library");
    }, DOWNLOAD_REFRESH_MS);
  };

  const canReport = document.status === "PUBLISHED" && !document.mine && !isAdmin;
  const topFeedback = feedback?.anchor === "top" ? feedback.value : null;

  return (
    <div className="space-y-6">
      <BackLink />

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <TypeBadge type={document.type} />
          <PriceBadge price={document.price} />
          <SubjectBadge subject={document.subject} />
          {document.status !== "PUBLISHED" && <StatusBadge status={document.status} />}
        </div>
        <h1 className="break-words text-2xl font-bold tracking-tight text-foreground sm:text-3xl" data-testid="document-title">
          {document.title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <RatingStars rating={document.rating} count={document.ratingCount} />
          <span className="inline-flex items-center gap-1">
            <Download className="h-4 w-4" aria-hidden="true" />
            {t("downloads", { count: document.downloads })}
          </span>
        </div>
      </header>

      <InlineFeedback feedback={topFeedback} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        {/* The purchase card comes first (phones show it right under the title); wide screens put it on the right. */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1">
          <PurchasePanel
            document={document}
            balance={wallet.data?.balance}
            onPurchased={onPurchased}
            onStale={onStale}
            onDownload={onDownload}
          />

          {(document.mine || canReport || isAdmin) && (
            <div role="group" aria-label={t("actionsLabel")} className="flex flex-wrap gap-2">
              {document.mine && online && (
                <EditDocumentDialog
                  document={document}
                  subjects={subjects}
                  currentYear={currentYear}
                  maxUploadMb={config.maxUploadMb}
                  isAdmin={isAdmin}
                  onSaved={(saved, message) => {
                    if (saved) setDocument(saved);
                    invalidateQueries("marketplace:mine");
                    reportTop({ type: "success", message: message ?? tMine("saved") });
                  }}
                />
              )}
              {document.mine && (
                <Button asChild variant="outline" size="sm" className={ACTION_BUTTON}>
                  <Link href={`${marketplaceHref}?tab=mine`}>
                    <FolderOpen className="h-4 w-4" aria-hidden="true" />
                    {t("myDocuments")}
                  </Link>
                </Button>
              )}
              {canReport && (
                <TextDialog
                  trigger={
                    <Button type="button" variant="outline" size="sm" className={ACTION_BUTTON} disabled={!online}>
                      <Flag className="h-4 w-4" aria-hidden="true" />
                      {tReport("open")}
                    </Button>
                  }
                  title={tReport("title")}
                  description={tReport("description")}
                  label={tReport("reason")}
                  hint={tReport("hint")}
                  submitLabel={tReport("send")}
                  maxLength={REPORT_REASON_MAX_LENGTH}
                  validate={(value) => validationMessage(validateReportReason(value))}
                  onSubmit={(reason) => run(() => reportDocumentAction(document.id, reason), { inDialog: true })}
                />
              )}
              {isAdmin && document.status === "PENDING_REVIEW" && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    className={ACTION_BUTTON}
                    disabled={!online}
                    onClick={() => void run(() => approveDocumentAction(document.id))}
                  >
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    {tModeration("approve")}
                  </Button>
                  <TextDialog
                    trigger={
                      <Button type="button" variant="outline" size="sm" className={`${ACTION_BUTTON} text-destructive hover:text-destructive`} disabled={!online}>
                        <XCircle className="h-4 w-4" aria-hidden="true" />
                        {tModeration("reject")}
                      </Button>
                    }
                    title={tModeration("rejectTitle")}
                    description={tModeration("rejectDescription")}
                    label={tModeration("rejectReason")}
                    submitLabel={tModeration("rejectSubmit")}
                    maxLength={DECISION_REASON_MAX_LENGTH}
                    destructive
                    validate={(value) => validationMessage(validateDecisionReason(value, true))}
                    onSubmit={(reason) => run(() => rejectDocumentAction(document.id, reason), { inDialog: true })}
                  />
                </>
              )}
              {isAdmin && document.status === "PUBLISHED" && (
                <TextDialog
                  trigger={
                    <Button type="button" variant="outline" size="sm" className={`${ACTION_BUTTON} text-destructive hover:text-destructive`} disabled={!online}>
                      <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                      {tModeration("unpublish")}
                    </Button>
                  }
                  title={tModeration("unpublishTitle")}
                  description={tModeration("unpublishDescription")}
                  label={tModeration("unpublishReason")}
                  submitLabel={tModeration("unpublishSubmit")}
                  maxLength={DECISION_REASON_MAX_LENGTH}
                  destructive
                  validate={(value) => validationMessage(validateDecisionReason(value, false))}
                  onSubmit={(reason) => run(() => unpublishDocumentAction(document.id, reason), { inDialog: true })}
                />
              )}
              {isAdmin && document.status === "UNPUBLISHED" && (
                <Button
                  type="button"
                  size="sm"
                  className={ACTION_BUTTON}
                  disabled={!online}
                  onClick={() => void run(() => approveDocumentAction(document.id))}
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  {tModeration("republish")}
                </Button>
              )}
            </div>
          )}
          {!online && <p className="text-sm text-muted-foreground">{t("offlineActions")}</p>}
        </aside>
        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
          <StatusNotice document={document} />
          <Facts document={document} />
          <section aria-labelledby="description-title" className="space-y-2">
            <h2 id="description-title" className="text-lg font-semibold">
              {t("descriptionTitle")}
            </h2>
            {document.description ? (
              <MarketText text={document.description} className="text-base leading-7" testId="document-description" />
            ) : (
              <p className="text-sm italic text-muted-foreground">{t("noDescription")}</p>
            )}
          </section>
        </div>

      </div>

      <ReviewsSection
        document={document}
        initial={initialReviews}
        viewerId={viewer.id}
        isAdmin={isAdmin}
        feedback={feedback?.anchor === "reviews" ? feedback.value : null}
        onDocument={setDocument}
        onFeedback={report("reviews")}
      />
    </div>
  );
}
