// Checks of the marketplace forms, run in the browser first and again in the Server Actions (same limits as the
// API). They return keys of `marketplace.validation.*` (messages/<locale>/marketplace.json) with their values.
import {
  COMMENT_MAX_LENGTH,
  DECISION_REASON_MAX_LENGTH,
  DECISION_REASON_MIN_LENGTH,
  DEFAULT_MAX_UPLOAD_MB,
  DESCRIPTION_MAX_LENGTH,
  isAcademicYear,
  isAcceptedFile,
  isDocumentType,
  isObjectId,
  LEVELS,
  MAX_PRICE,
  MIN_PRICE,
  NOTE_MAX_LENGTH,
  PROFESSOR_MAX_LENGTH,
  RATINGS,
  REPORT_REASON_MAX_LENGTH,
  REPORT_REASON_MIN_LENGTH,
  TITLE_MAX_LENGTH,
  TITLE_MIN_LENGTH,
  type DocumentType,
} from "@/lib/marketplace/types";

export type MarketValidationKey =
  | "titleTooShort"
  | "titleTooLong"
  | "descriptionTooLong"
  | "subjectRequired"
  | "typeInvalid"
  | "levelInvalid"
  | "yearInvalid"
  | "professorTooLong"
  | "priceInvalid"
  | "fileRequired"
  | "fileType"
  | "fileTooLarge"
  | "ratingRequired"
  | "commentTooLong"
  | "reasonTooShort"
  | "reasonTooLong"
  | "noteTooLong";

export type MarketValidationError = { key: MarketValidationKey; values?: Record<string, number | string> };
export type MarketValidationErrors = Record<string, MarketValidationError>;

export const hasValidationErrors = (errors: MarketValidationErrors) => Object.keys(errors).length > 0;

/** Same normalisation as the API: line breaks as LF; one-line fields on one line. */
export const normalizeText = (value: string) => value.replace(/\r\n?/g, "\n").trim();
export const normalizeLine = (value: string) => value.replace(/\s+/g, " ").trim();

export const DOCUMENT_FIELDS = ["title", "description", "subject", "type", "level", "academicYear", "professor", "price"] as const;
export type DocumentField = (typeof DOCUMENT_FIELDS)[number];

/** What the upload / edit form holds (strings, as typed). */
export type DocumentInput = Record<DocumentField, string>;

/** JSON fields of POST (multipart `data`) / PATCH /api/marketplace/documents. */
export type DocumentPayload = {
  title?: string;
  description?: string;
  subject?: string;
  type?: DocumentType;
  level?: number | null;
  academicYear?: string;
  professor?: string | null;
  price?: number;
};

/** "12" -> 12; anything that is not a whole number of tokens in range -> null. */
export function parsePrice(value: string): number | null {
  const text = value.trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  const price = Number(text);
  return price >= MIN_PRICE && price <= MAX_PRICE ? price : null;
}

/**
 * Checks the fields of the upload / edit form. `fields` limits the check and the payload (a published document
 * only changes its price).
 */
export function validateDocument(
  input: DocumentInput,
  fields: readonly DocumentField[] = DOCUMENT_FIELDS
): { errors: MarketValidationErrors; payload: DocumentPayload } {
  const errors: MarketValidationErrors = {};
  const payload: DocumentPayload = {};
  const has = (field: DocumentField) => fields.includes(field);

  if (has("title")) {
    const title = normalizeLine(input.title);
    if (title.length < TITLE_MIN_LENGTH) errors.title = { key: "titleTooShort", values: { min: TITLE_MIN_LENGTH } };
    else if (title.length > TITLE_MAX_LENGTH) errors.title = { key: "titleTooLong", values: { max: TITLE_MAX_LENGTH } };
    payload.title = title;
  }
  if (has("description")) {
    const description = normalizeText(input.description);
    if (description.length > DESCRIPTION_MAX_LENGTH) {
      errors.description = { key: "descriptionTooLong", values: { max: DESCRIPTION_MAX_LENGTH } };
    }
    payload.description = description;
  }
  if (has("subject")) {
    if (!isObjectId(input.subject)) errors.subject = { key: "subjectRequired" };
    payload.subject = input.subject;
  }
  if (has("type")) {
    const type = input.type.toUpperCase();
    if (!isDocumentType(type)) errors.type = { key: "typeInvalid" };
    else payload.type = type;
  }
  if (has("level")) {
    const level = input.level ? Number(input.level) : null;
    if (level !== null && !(LEVELS as readonly number[]).includes(level)) errors.level = { key: "levelInvalid" };
    payload.level = level;
  }
  if (has("academicYear")) {
    const year = input.academicYear.trim();
    if (!isAcademicYear(year)) errors.academicYear = { key: "yearInvalid" };
    payload.academicYear = year;
  }
  if (has("professor")) {
    const professor = normalizeLine(input.professor);
    if (professor.length > PROFESSOR_MAX_LENGTH) errors.professor = { key: "professorTooLong", values: { max: PROFESSOR_MAX_LENGTH } };
    payload.professor = professor || null;
  }
  if (has("price")) {
    const price = parsePrice(input.price);
    if (price === null) errors.price = { key: "priceInvalid", values: { min: MIN_PRICE, max: MAX_PRICE } };
    else payload.price = price;
  }
  return { errors, payload };
}

/** The file of an upload: required, an accepted type, at most `maxMb`. */
export function validateFile(file: { name: string; size: number } | null, maxMb = DEFAULT_MAX_UPLOAD_MB): MarketValidationError | null {
  if (!file || !file.name || file.size <= 0) return { key: "fileRequired" };
  if (!isAcceptedFile(file.name)) return { key: "fileType", values: { name: file.name } };
  if (file.size > maxMb * 1024 * 1024) return { key: "fileTooLarge", values: { max: maxMb } };
  return null;
}

export function validateReview(rating: number, comment: string): MarketValidationErrors {
  const errors: MarketValidationErrors = {};
  if (!(RATINGS as readonly number[]).includes(rating)) errors.rating = { key: "ratingRequired" };
  if (normalizeText(comment).length > COMMENT_MAX_LENGTH) errors.comment = { key: "commentTooLong", values: { max: COMMENT_MAX_LENGTH } };
  return errors;
}

/** Reason of a report (5–500 characters). */
export function validateReportReason(reason: string): MarketValidationError | null {
  const text = normalizeText(reason);
  if (text.length < REPORT_REASON_MIN_LENGTH) return { key: "reasonTooShort", values: { min: REPORT_REASON_MIN_LENGTH } };
  if (text.length > REPORT_REASON_MAX_LENGTH) return { key: "reasonTooLong", values: { max: REPORT_REASON_MAX_LENGTH } };
  return null;
}

/** Reason of a rejection (required, 3–500) or of an unpublication (optional, ≤ 500). */
export function validateDecisionReason(reason: string, required: boolean): MarketValidationError | null {
  const text = normalizeText(reason);
  if (required && text.length < DECISION_REASON_MIN_LENGTH) return { key: "reasonTooShort", values: { min: DECISION_REASON_MIN_LENGTH } };
  if (text.length > DECISION_REASON_MAX_LENGTH) return { key: "reasonTooLong", values: { max: DECISION_REASON_MAX_LENGTH } };
  return null;
}

export function validateNote(note: string): MarketValidationError | null {
  return normalizeText(note).length > NOTE_MAX_LENGTH ? { key: "noteTooLong", values: { max: NOTE_MAX_LENGTH } } : null;
}
