"use server";

import { getTranslations } from "next-intl/server";
import { actionFailure, actionSuccess, serverApi, type ActionState } from "@/lib/server-api";
import { formText } from "@/lib/validation";
import { documentPath, reviewsPath } from "@/lib/marketplace/paths";
import { marketFailure, marketValidationFailure } from "@/lib/marketplace/server";
import {
  DEFAULT_MAX_UPLOAD_MB,
  fileExtension,
  FILE_TYPES,
  isObjectId,
  MAX_PRICE,
  MIN_PRICE,
  type MarketDocument,
  type PurchaseResult,
  type ReviewList,
} from "@/lib/marketplace/types";
import {
  DOCUMENT_FIELDS,
  hasValidationErrors,
  normalizeText,
  validateDocument,
  validateFile,
  validateReportReason,
  validateReview,
  type DocumentField,
  type DocumentInput,
} from "@/lib/marketplace/validation";

/*
 * Marketplace mutations that can fail with an expected 4xx (docs: next/README.md "Data layer"): they run on the
 * server with serverApi(), so the browser never logs a failed request. The pages update their offline queries with
 * the returned data.
 */

/** After a review change: the document (new average) and the first page of its reviews. */
export type ReviewsUpdate = { document: MarketDocument; reviews: ReviewList };

const invalidInput = <T>() => actionFailure<T>(new Error("Invalid input"));

function readDocumentInput(source: Partial<Record<string, unknown>>): DocumentInput {
  return Object.fromEntries(
    DOCUMENT_FIELDS.map((field) => [field, typeof source[field] === "string" ? (source[field] as string) : ""])
  ) as DocumentInput;
}

async function currentMaxUploadMb(): Promise<number> {
  try {
    const config = await serverApi<{ maxUploadMb?: unknown }>("/marketplace/config");
    return typeof config?.maxUploadMb === "number" && config.maxUploadMb > 0 ? config.maxUploadMb : DEFAULT_MAX_UPLOAD_MB;
  } catch {
    return DEFAULT_MAX_UPLOAD_MB;
  }
}

/**
 * "Send for review" / "Publish" of the "Share a document" form: multipart `data` (JSON) + `file`
 * → POST /api/marketplace/documents. ADMIN uploads are published at once, the others wait for a review.
 */
export async function uploadDocumentAction(formData: FormData): Promise<ActionState<MarketDocument>> {
  const input = readDocumentInput(Object.fromEntries(DOCUMENT_FIELDS.map((field) => [field, formText(formData, field)])));
  const { errors, payload } = validateDocument(input);
  const entry = formData.get("file");
  const file = entry && typeof entry !== "string" && entry.size > 0 && entry.name ? entry : null;
  const fileError = validateFile(file, await currentMaxUploadMb());
  if (fileError) errors.file = fileError;
  if (hasValidationErrors(errors) || !file) return marketValidationFailure(errors);

  // Some systems report an empty or generic MIME type: the API checks it against the extension and the content.
  const expected = FILE_TYPES[fileExtension(file.name)];
  const upload = file.type === expected ? file : new File([file], file.name, { type: expected });
  const multipart = new FormData();
  multipart.set("data", JSON.stringify(payload));
  multipart.append("file", upload, file.name);

  try {
    const document = await serverApi<MarketDocument>("/marketplace/documents", { method: "POST", body: multipart });
    const t = await getTranslations("marketplace.upload");
    return actionSuccess(t(document.status === "PUBLISHED" ? "published" : "sent"), { data: document });
  } catch (e) {
    return marketFailure<MarketDocument>(e, "upload");
  }
}

/**
 * "Save changes" of the edit form (author): PATCH /api/marketplace/documents/:id with the editable fields
 * (a published document only changes its price; a rejected one goes back to the review queue).
 */
export async function updateDocumentAction(
  id: string,
  values: Partial<Record<DocumentField, string>>,
  fields: DocumentField[],
  wasRejected = false
): Promise<ActionState<MarketDocument>> {
  if (!isObjectId(id) || !Array.isArray(fields) || fields.length === 0 || !fields.every((field) => DOCUMENT_FIELDS.includes(field))) {
    return invalidInput();
  }
  const { errors, payload } = validateDocument(readDocumentInput(values ?? {}), fields);
  if (hasValidationErrors(errors)) return marketValidationFailure(errors);
  try {
    const document = await serverApi<MarketDocument>(documentPath(id), { method: "PATCH", body: payload });
    const t = await getTranslations("marketplace.mine");
    return actionSuccess(t(wasRejected && document.status === "PENDING_REVIEW" ? "resubmitted" : "saved"), { data: document });
  } catch (e) {
    return marketFailure<MarketDocument>(e, "edit");
  }
}

/** "Confirm delete" (author, only while nobody bought it). */
export async function deleteDocumentAction(id: string): Promise<ActionState> {
  if (!isObjectId(id)) return invalidInput();
  try {
    await serverApi(documentPath(id), { method: "DELETE" });
    const t = await getTranslations("marketplace.mine");
    return actionSuccess(t("deleted"));
  } catch (e) {
    return marketFailure(e, "delete");
  }
}

/**
 * "Confirm purchase": POST /api/marketplace/documents/:id/purchase { expectedPrice } (the price the buyer saw, so
 * they are never charged more than what they confirmed) → { purchase, balance, document }.
 */
export async function purchaseDocumentAction(id: string, expectedPrice: number): Promise<ActionState<PurchaseResult>> {
  if (!isObjectId(id) || !Number.isInteger(expectedPrice) || expectedPrice < MIN_PRICE || expectedPrice > MAX_PRICE) {
    return invalidInput();
  }
  try {
    const result = await serverApi<PurchaseResult>(`${documentPath(id)}/purchase`, { method: "POST", body: { expectedPrice } });
    const t = await getTranslations("marketplace.buy");
    return actionSuccess(t("done", { balance: result.balance }), { data: result });
  } catch (e) {
    return marketFailure<PurchaseResult>(e, "purchase");
  }
}

async function loadReviewsUpdate(id: string): Promise<ReviewsUpdate | undefined> {
  try {
    const [document, reviews] = await Promise.all([
      serverApi<MarketDocument>(documentPath(id)),
      serverApi<ReviewList>(reviewsPath(id, 1)),
    ]);
    return { document, reviews };
  } catch {
    return undefined;
  }
}

/** "Publish my review" / "Update my review": PUT /api/marketplace/documents/:id/review { rating, comment }. */
export async function saveReviewAction(id: string, rating: number, comment: string): Promise<ActionState<ReviewsUpdate>> {
  if (!isObjectId(id) || typeof comment !== "string") return invalidInput();
  const errors = validateReview(rating, comment);
  if (hasValidationErrors(errors)) return marketValidationFailure(errors);
  try {
    await serverApi(`${documentPath(id)}/review`, { method: "PUT", body: { rating, comment: normalizeText(comment) } });
  } catch (e) {
    return marketFailure<ReviewsUpdate>(e, "review");
  }
  const t = await getTranslations("marketplace.reviews");
  return actionSuccess(t("saved"), { data: await loadReviewsUpdate(id) });
}

/** "Delete my review": DELETE /api/marketplace/documents/:id/review. */
export async function deleteOwnReviewAction(id: string): Promise<ActionState<ReviewsUpdate>> {
  if (!isObjectId(id)) return invalidInput();
  try {
    await serverApi(`${documentPath(id)}/review`, { method: "DELETE" });
  } catch (e) {
    return marketFailure<ReviewsUpdate>(e, "review");
  }
  const t = await getTranslations("marketplace.reviews");
  return actionSuccess(t("deleted"), { data: await loadReviewsUpdate(id) });
}

/** "Send report": POST /api/marketplace/documents/:id/report { reason } (one open report per user). */
export async function reportDocumentAction(id: string, reason: string): Promise<ActionState> {
  if (!isObjectId(id) || typeof reason !== "string") return invalidInput();
  const error = validateReportReason(reason);
  if (error) return marketValidationFailure({ reason: error });
  try {
    await serverApi(`${documentPath(id)}/report`, { method: "POST", body: { reason: normalizeText(reason) } });
  } catch (e) {
    return marketFailure(e, "report");
  }
  const t = await getTranslations("marketplace.report");
  return actionSuccess(t("sent"));
}
