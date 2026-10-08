"use client";

import { useState, useTransition } from "react";
import { Loader2, MessageSquareText, Send, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { MarketText } from "@/components/marketplace/market-text";
import { RatingInput, RatingStars, ReviewStars } from "@/components/marketplace/rating-stars";
import { useDateLabel, usePersonName, useValidationMessage } from "@/components/marketplace/use-market-format";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback, type Feedback } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { SkeletonList } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useErrorFormatter } from "@/lib/i18n/client";
import { useOfflineQuery, useOnlineStatus } from "@/lib/offline";
import { REVIEWS_PAGE_SIZE, reviewsKey, reviewsPath } from "@/lib/marketplace/paths";
import type { Snapshot } from "@/lib/marketplace/queries";
import { COMMENT_MAX_LENGTH, isReviewList, RATINGS, type MarketDocument, type Review, type ReviewList } from "@/lib/marketplace/types";
import { validateReview } from "@/lib/marketplace/validation";
import { deleteReviewAsAdminAction } from "@/app/(back)/dashboard/admin/marketplace/actions";
import { deleteOwnReviewAction, saveReviewAction, type ReviewsUpdate } from "@/app/(back)/dashboard/marketplace/actions";

type Result = { ok?: boolean; message?: string; fieldErrors?: Record<string, string>; data?: ReviewsUpdate };

/**
 * Average, number of reviews and the 5..1 star distribution: each bar is that rating's share of all the reviews
 * (bars are decorative, the counts are text).
 */
function Summary({ document, reviews }: { document: MarketDocument; reviews: ReviewList | undefined }) {
  const t = useTranslations("marketplace.reviews");
  const distribution = reviews?.distribution;
  const total = distribution ? Math.max(1, RATINGS.reduce((sum, rating) => sum + (distribution[String(rating) as "1"] ?? 0), 0)) : 1;
  return (
    <div className="grid gap-4 rounded-2xl border bg-card p-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center sm:p-5">
      <div className="space-y-1">
        <RatingStars rating={document.rating} count={document.ratingCount} size="lg" />
        <p className="text-sm text-muted-foreground">{t("count", { count: document.ratingCount })}</p>
      </div>
      {distribution && (
        <ul className="space-y-1.5" aria-label={t("distribution")}>
          {[...RATINGS].reverse().map((rating) => {
            const count = distribution[String(rating) as "1"] ?? 0;
            return (
              <li key={rating} className="grid grid-cols-[4.5rem_minmax(0,1fr)_2rem] items-center gap-2 text-xs">
                <span className="text-muted-foreground">{t("starsLabel", { count: rating })}</span>
                <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <span className="block h-full rounded-full bg-highlight" style={{ width: `${Math.round((count / total) * 100)}%` }} />
                </span>
                <span className="text-right tabular-nums text-muted-foreground">{count}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** "Your review": rating + optional comment, "Publish my review" / "Update my review", "Delete my review". */
function ReviewForm({
  documentId,
  myReview,
  onUpdate,
  onFeedback,
}: {
  documentId: string;
  myReview: Review | null;
  onUpdate: (update: ReviewsUpdate | undefined) => void;
  onFeedback: (feedback: Feedback) => void;
}) {
  const t = useTranslations("marketplace.reviews");
  const errors = useErrorFormatter();
  const message = useValidationMessage();
  const online = useOnlineStatus();
  const [rating, setRating] = useState(myReview?.rating ?? 0);
  const [comment, setComment] = useState(myReview?.comment ?? "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<Result>, onSuccess?: () => void) =>
    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok) {
          setFieldErrors({});
          onUpdate(result.data);
          onSuccess?.();
          onFeedback({ type: "success", message: result.message ?? t("saved") });
        } else {
          setFieldErrors(result.fieldErrors ?? {});
          onFeedback({ type: "error", message: result.message ?? errors.forCode("GENERIC") });
        }
      } catch {
        onFeedback({ type: "error", message: errors.forCode("NETWORK_ERROR") });
      }
    });

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const problems = validateReview(rating, comment);
    const translated = Object.fromEntries(Object.entries(problems).map(([field, error]) => [field, message(error) ?? ""]));
    if (Object.keys(translated).length > 0) {
      setFieldErrors(translated);
      onFeedback({ type: "error", message: Object.values(translated).join(" ") });
      return;
    }
    run(() => saveReviewAction(documentId, rating, comment));
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5" aria-labelledby="my-review-title">
      <h3 id="my-review-title" className="font-semibold">
        {myReview ? t("editTitle") : t("formTitle")}
      </h3>
      <RatingInput
        name="review-rating"
        legend={t("rating")}
        value={rating}
        onChange={(value) => {
          setRating(value);
          setFieldErrors((current) => (current.rating ? { ...current, rating: "" } : current));
        }}
        error={fieldErrors.rating}
        errorId="review-rating-error"
        disabled={pending}
      />
      <Field id="review-comment" label={t("comment")} hint={t("commentHint", { max: COMMENT_MAX_LENGTH })} error={fieldErrors.comment}>
        {(props) => (
          <Textarea
            {...props}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={COMMENT_MAX_LENGTH}
            rows={3}
            className="min-h-20"
            disabled={pending}
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {myReview && (
          <ConfirmDialog
            trigger={
              <Button type="button" variant="outline" className="rounded-full text-destructive hover:text-destructive" disabled={pending || !online}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {t("delete")}
              </Button>
            }
            title={t("deleteTitle")}
            description={t("deleteDescription")}
            confirmLabel={t("confirmDelete")}
            onConfirm={() =>
              run(
                () => deleteOwnReviewAction(documentId),
                () => {
                  setRating(0);
                  setComment("");
                }
              )
            }
          />
        )}
        <Button type="submit" className="rounded-full" disabled={pending || !online} aria-busy={pending || undefined}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          {myReview ? t("update") : t("publish")}
        </Button>
      </div>
    </form>
  );
}

/** One review: stars, author, date ("edited"), comment; ADMINs can delete it. */
function ReviewItem({
  review,
  mine,
  isAdmin,
  documentId,
  onUpdate,
  onFeedback,
}: {
  review: Review;
  mine: boolean;
  isAdmin: boolean;
  documentId: string;
  onUpdate: (update: ReviewsUpdate | undefined) => void;
  onFeedback: (feedback: Feedback) => void;
}) {
  const t = useTranslations("marketplace.reviews");
  const errors = useErrorFormatter();
  const online = useOnlineStatus();
  const dateLabel = useDateLabel();
  const personName = usePersonName();

  const remove = async () => {
    try {
      const result = await deleteReviewAsAdminAction(review.id, documentId);
      if (result.ok) {
        onUpdate(result.data);
        onFeedback({ type: "success", message: result.message ?? t("deletedByAdmin") });
      } else {
        onFeedback({ type: "error", message: result.message ?? errors.forCode("GENERIC") });
      }
    } catch {
      onFeedback({ type: "error", message: errors.forCode("NETWORK_ERROR") });
    }
  };

  return (
    <li>
      <article className="space-y-2 rounded-2xl border bg-card p-4 text-card-foreground" data-review-id={review.id} data-rating={review.rating}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ReviewStars rating={review.rating} />
          <span className="text-sm font-semibold">{personName(review.author)}</span>
          {mine && <Badge variant="secondary">{t("yours")}</Badge>}
          <span className="text-xs text-muted-foreground">
            <time dateTime={review.createdAt}>{dateLabel(review.createdAt)}</time>
            {review.editedAt && <> · {t("edited")}</>}
          </span>
        </div>
        {review.comment ? (
          <MarketText text={review.comment} testId="review-comment" />
        ) : (
          <p className="text-sm italic text-muted-foreground">{t("noComment")}</p>
        )}
        {isAdmin && online && (
          <div className="flex justify-end">
            <ConfirmDialog
              trigger={
                <Button type="button" variant="ghost" size="sm" className="rounded-full text-destructive hover:text-destructive">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  {t("adminDelete")}
                  <span className="sr-only">: {personName(review.author)}</span>
                </Button>
              }
              title={t("adminDeleteTitle")}
              description={t("adminDeleteDescription")}
              confirmLabel={t("confirmDelete")}
              onConfirm={remove}
            />
          </div>
        )}
      </article>
    </li>
  );
}

/** Pages 2..n of the reviews ("Load more"). */
function NextReviewsPage({
  documentId,
  page,
  ...item
}: {
  documentId: string;
  page: number;
  viewerId: string;
  isAdmin: boolean;
  onUpdate: (update: ReviewsUpdate | undefined) => void;
  onFeedback: (feedback: Feedback) => void;
}) {
  const t = useTranslations("marketplace.reviews");
  const tStates = useTranslations("common.states");
  const { data, isLoading } = useOfflineQuery<ReviewList>(reviewsKey(documentId, page), reviewsPath(documentId, page));
  if (isLoading) {
    return (
      <li>
        <SkeletonList rows={2} label={tStates("loading")} />
      </li>
    );
  }
  if (!isReviewList(data)) return <li className="px-1 text-sm text-muted-foreground">{t("pageError")}</li>;
  return (
    <>
      {data.items.map((review) => (
        <ReviewItem
          key={review.id}
          review={review}
          mine={review.author?.id === item.viewerId}
          isAdmin={item.isAdmin}
          documentId={documentId}
          onUpdate={item.onUpdate}
          onFeedback={item.onFeedback}
        />
      ))}
    </>
  );
}

/**
 * "Reviews" of the document page: summary (average + distribution), "Your review" (only for users who downloaded
 * a free document or bought a premium one; never the author), then the reviews, newest first.
 * `feedback` is shown here (outcomes of the actions of this section).
 */
export function ReviewsSection({
  document,
  initial,
  viewerId,
  isAdmin,
  feedback,
  onDocument,
  onFeedback,
}: {
  document: MarketDocument;
  initial: Snapshot<ReviewList>;
  viewerId: string;
  isAdmin: boolean;
  feedback: Feedback | null;
  onDocument: (document: MarketDocument) => void;
  onFeedback: (feedback: Feedback) => void;
}) {
  const t = useTranslations("marketplace.reviews");
  const tStates = useTranslations("common.states");
  const tActions = useTranslations("common.actions");
  const [pages, setPages] = useState(1);
  const reviews = useOfflineQuery<ReviewList>(reviewsKey(document.id, 1), reviewsPath(document.id, 1), {
    fallbackData: initial?.data ?? undefined,
    fallbackSavedAt: initial?.savedAt,
    revalidateOnMount: !initial?.data,
  });
  const list = isReviewList(reviews.data) ? reviews.data : undefined;

  const onUpdate = (update: ReviewsUpdate | undefined) => {
    if (!update) {
      void reviews.refresh();
      return;
    }
    reviews.mutate(update.reviews);
    onDocument(update.document);
    setPages(1);
  };

  const published = document.status === "PUBLISHED";
  const canReview = (list?.canReview ?? document.canReview) === true;
  const total = list?.total ?? 0;

  return (
    <section aria-labelledby="reviews-title" className="space-y-4">
      <h2 id="reviews-title" className="flex items-center gap-2 text-xl font-semibold">
        <MessageSquareText className="h-5 w-5 text-primary" aria-hidden="true" />
        {t("title")}
      </h2>
      {document.ratingCount > 0 && <Summary document={document} reviews={list} />}
      <InlineFeedback feedback={feedback} />

      {published && !document.mine && canReview && list && (
        <ReviewForm
          key={list.myReview?.id ?? "new"}
          documentId={document.id}
          myReview={list.myReview}
          onUpdate={onUpdate}
          onFeedback={onFeedback}
        />
      )}
      {published && !document.mine && !canReview && list && (
        <p className="rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
          {document.price === 0 ? t("acquireFree") : t("acquirePremium")}
        </p>
      )}
      {document.mine && <p className="rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground">{t("ownDocument")}</p>}

      {reviews.isLoading ? (
        <SkeletonList rows={2} label={tStates("loading")} />
      ) : !list ? (
        <p className="text-sm text-muted-foreground">{t("loadError")}</p>
      ) : list.items.length === 0 ? (
        <EmptyState icon={MessageSquareText} title={t("empty")} description={published ? t("emptyText") : undefined} headingLevel="p" />
      ) : (
        <>
          <ul className="space-y-3" aria-label={t("listLabel")}>
            {list.items.map((review) => (
              <ReviewItem
                key={review.id}
                review={review}
                mine={review.author?.id === viewerId}
                isAdmin={isAdmin}
                documentId={document.id}
                onUpdate={onUpdate}
                onFeedback={onFeedback}
              />
            ))}
            {Array.from({ length: pages - 1 }, (_, index) => (
              <NextReviewsPage
                key={index + 2}
                documentId={document.id}
                page={index + 2}
                viewerId={viewerId}
                isAdmin={isAdmin}
                onUpdate={onUpdate}
                onFeedback={onFeedback}
              />
            ))}
          </ul>
          {total > pages * REVIEWS_PAGE_SIZE && (
            <div className="flex justify-center">
              <Button variant="outline" className="rounded-full" onClick={() => setPages((count) => count + 1)}>
                {tActions("loadMore")}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
