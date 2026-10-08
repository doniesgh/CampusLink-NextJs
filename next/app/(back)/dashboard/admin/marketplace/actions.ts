"use server";

import { refresh } from "next/cache";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/dal";
import { actionFailure, actionSuccess, serverApi, type ActionState } from "@/lib/server-api";
import { documentPath, moderationHref, reviewsPath } from "@/lib/marketplace/paths";
import { marketFailure, marketValidationFailure } from "@/lib/marketplace/server";
import { isObjectId, type MarketDocument, type ReviewList } from "@/lib/marketplace/types";
import { normalizeText, validateDecisionReason, validateNote } from "@/lib/marketplace/validation";

/*
 * Moderation (ADMIN): approve / reject the documents waiting for a review, unpublish, resolve reports, delete a
 * review. Used by /dashboard/admin/marketplace (`refreshPage: true` renders its lists again) and by the document
 * page (which updates its own data with the returned document).
 */

type Options = { refreshPage?: boolean };

async function ensureAdmin<T = undefined>(): Promise<ActionState<T> | null> {
  const { user, error } = await requireRole(["ADMIN"], moderationHref);
  return user ? null : actionFailure<T>(error);
}

const invalidInput = <T>() => actionFailure<T>(new Error("Invalid input"));

/** POST /documents/:id/{approve|reject|unpublish}: the decision is a compare-and-set on the status (409 when another admin was faster). */
async function decide(
  id: string,
  decision: "approve" | "reject" | "unpublish",
  body: Record<string, string>,
  options: Options
): Promise<ActionState<MarketDocument>> {
  let document: MarketDocument;
  try {
    document = await serverApi<MarketDocument>(`${documentPath(id)}/${decision}`, { method: "POST", body });
  } catch (e) {
    const state = await marketFailure<MarketDocument>(e, "moderation");
    // Someone else decided meanwhile: show the current lists.
    if (options.refreshPage && (state.code === "INVALID_STATE" || state.code === "RESOURCE_NOT_FOUND")) refresh();
    return state;
  }
  if (options.refreshPage) refresh();
  const t = await getTranslations("marketplace.moderation");
  const key = decision === "approve" ? "approvedDone" : decision === "reject" ? "rejectedDone" : "unpublishedDone";
  return actionSuccess(t(key, { title: document.title }), { data: document });
}

/** "Approve" (PENDING_REVIEW) or "Publish again" (UNPUBLISHED) → PUBLISHED; the author is notified. */
export async function approveDocumentAction(id: string, options: Options = {}): Promise<ActionState<MarketDocument>> {
  const denied = await ensureAdmin<MarketDocument>();
  if (denied) return denied;
  if (!isObjectId(id)) return invalidInput();
  return decide(id, "approve", {}, options);
}

/** "Reject document" with the reason shown to the author (required, 3–500 characters). */
export async function rejectDocumentAction(id: string, reason: string, options: Options = {}): Promise<ActionState<MarketDocument>> {
  const denied = await ensureAdmin<MarketDocument>();
  if (denied) return denied;
  if (!isObjectId(id) || typeof reason !== "string") return invalidInput();
  const error = validateDecisionReason(reason, true);
  if (error) return marketValidationFailure({ reason: error });
  return decide(id, "reject", { reason: normalizeText(reason) }, options);
}

/** "Unpublish" a published document (optional reason, shown to the author); resolves its open reports. */
export async function unpublishDocumentAction(id: string, reason: string, options: Options = {}): Promise<ActionState<MarketDocument>> {
  const denied = await ensureAdmin<MarketDocument>();
  if (denied) return denied;
  if (!isObjectId(id) || typeof reason !== "string") return invalidInput();
  const error = validateDecisionReason(reason, false);
  if (error) return marketValidationFailure({ reason: error });
  const text = normalizeText(reason);
  return decide(id, "unpublish", text ? { reason: text } : {}, options);
}

/** "Resolve report" with an optional note: outcome UNPUBLISHED when the document is unpublished, else NO_ACTION. */
export async function resolveReportAction(id: string, note: string): Promise<ActionState> {
  const denied = await ensureAdmin();
  if (denied) return denied;
  if (!isObjectId(id) || typeof note !== "string") return invalidInput();
  const error = validateNote(note);
  if (error) return marketValidationFailure({ note: error });
  const text = normalizeText(note);
  try {
    await serverApi(`/marketplace/reports/${encodeURIComponent(id)}/resolve`, { method: "POST", body: text ? { note: text } : {} });
  } catch (e) {
    const state = await marketFailure<undefined>(e, "resolve");
    if (state.code === "INVALID_STATE") refresh();
    return state;
  }
  refresh();
  const t = await getTranslations("marketplace.moderation");
  return actionSuccess(t("resolvedDone"));
}

/** ADMIN "Delete" of any review (audited) → the document (new average) and the first page of its reviews. */
export async function deleteReviewAsAdminAction(
  reviewId: string,
  documentId: string
): Promise<ActionState<{ document: MarketDocument; reviews: ReviewList }>> {
  const denied = await ensureAdmin<{ document: MarketDocument; reviews: ReviewList }>();
  if (denied) return denied;
  if (!isObjectId(reviewId) || !isObjectId(documentId)) return invalidInput();
  try {
    await serverApi(`/marketplace/reviews/${encodeURIComponent(reviewId)}`, { method: "DELETE" });
  } catch (e) {
    return marketFailure(e, "review");
  }
  const t = await getTranslations("marketplace.reviews");
  try {
    const [document, reviews] = await Promise.all([
      serverApi<MarketDocument>(documentPath(documentId)),
      serverApi<ReviewList>(reviewsPath(documentId, 1)),
    ]);
    return actionSuccess(t("deletedByAdmin"), { data: { document, reviews } });
  } catch {
    return actionSuccess(t("deletedByAdmin"));
  }
}
