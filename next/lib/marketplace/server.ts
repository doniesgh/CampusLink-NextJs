import "server-only";
import { getTranslations } from "next-intl/server";
import { toApiError } from "@/lib/api";
import { actionFailure, type ActionState } from "@/lib/server-api";
import { DEFAULT_MAX_UPLOAD_MB, isDocumentStatus } from "@/lib/marketplace/types";
import type { MarketValidationErrors } from "@/lib/marketplace/validation";

/** What the action was doing: picks the wording of the codes whose generic text would be too vague. */
export type MarketContext = "upload" | "edit" | "delete" | "purchase" | "review" | "report" | "moderation" | "resolve";

const numberOr = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/** Localised field errors of the marketplace forms (checked before calling the API). */
export async function marketValidationFailure<T>(errors: MarketValidationErrors): Promise<ActionState<T>> {
  const t = await getTranslations("marketplace.validation");
  const fieldErrors = Object.fromEntries(Object.entries(errors).map(([field, error]) => [field, t(error.key, error.values)]));
  return { ok: false, code: "VALIDATION_ERROR", message: Object.values(fieldErrors).join(" "), fieldErrors, at: Date.now() };
}

/** Anything a marketplace Server Action caught -> localised failed state (401 goes to /auth/expired). */
export async function marketFailure<T>(error: unknown, context: MarketContext, extra: Partial<ActionState<T>> = {}): Promise<ActionState<T>> {
  const apiError = toApiError(error);
  const state = await actionFailure<T>(apiError, extra);
  const t = await getTranslations("marketplace.errors");
  const tStatus = await getTranslations("marketplace.status");
  const details = (apiError.details && typeof apiError.details === "object" ? apiError.details : {}) as Record<string, unknown>;
  const with_ = (message: string, fieldErrors = state.fieldErrors) => ({ ...state, message, fieldErrors });

  switch (apiError.code) {
    case "INSUFFICIENT_TOKENS":
      return with_(t("insufficientTokens", { balance: numberOr(details.balance, 0), price: numberOr(details.price, 0) }));
    case "ALREADY_PURCHASED":
      return with_(t("alreadyPurchased"));
    case "PRICE_CHANGED":
      return with_(t("priceChanged", { price: numberOr(details.price, 0) }));
    case "IN_USE": {
      const references = (details.references ?? {}) as Record<string, unknown>;
      return with_(t("inUse", { count: numberOr(references.purchases, 1) }));
    }
    case "RESOURCE_NOT_FOUND":
      return with_(context === "resolve" ? t("reportNotFound") : t("notFound"));
    case "FILE_TOO_LARGE": {
      const maxBytes = numberOr(details.maxBytes, DEFAULT_MAX_UPLOAD_MB * 1024 * 1024);
      const message = t("fileTooLarge", { max: Math.max(1, Math.round(maxBytes / (1024 * 1024))) });
      return with_(message, { ...state.fieldErrors, file: message });
    }
    case "UNSUPPORTED_FILE_TYPE": {
      const message = t("fileType");
      return with_(message, { ...state.fieldErrors, file: message });
    }
    case "TOO_MANY_REQUESTS":
      if (context === "upload") return with_(t("tooManyUploads"));
      if (context === "report") return with_(t("tooManyReports"));
      return state;
    case "FORBIDDEN":
      if (details.reason === "NOT_ACQUIRED") return with_(t("notAcquired"));
      if (details.reason === "OWN_DOCUMENT") return with_(t("ownDocumentReview"));
      if (context === "report") return with_(t("ownDocumentReport"));
      if (context === "purchase") return with_(t("ownDocumentPurchase"));
      if (context === "edit" || context === "delete") return with_(t("authorOnly"));
      return state;
    case "INVALID_STATE": {
      if (details.reason === "FREE_DOCUMENT") return with_(t("freeDocument"));
      if (Array.isArray(details.fields)) return with_(t("publishedPriceOnly"));
      if (context === "resolve") return with_(t("reportAlreadyResolved"));
      const status = isDocumentStatus(details.status) ? tStatus(details.status) : null;
      if (context === "moderation") return with_(status ? t("alreadyDecided", { status }) : t("changedMeanwhile"));
      if (context === "purchase" || context === "review" || context === "report") return with_(t("notAvailable"));
      if (context === "edit" && details.status === "UNPUBLISHED") return with_(t("unpublishedLocked"));
      return with_(t("changedMeanwhile"));
    }
    default:
      return state;
  }
}
