// Module 3 (notes marketplace): shapes of /api/marketplace (docs/phase3-contract.md section 3,
// backend/docs/marketplace.md). Types and constants only: usable from Server and Client Components.
import type { Paginated, Role, Subject } from "@/lib/types";

export const DOCUMENT_TYPES = ["COURSE_NOTES", "SUMMARY", "EXERCISES", "EXAM_PREP", "SLIDES", "OTHER"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_STATUSES = ["PENDING_REVIEW", "PUBLISHED", "REJECTED", "UNPUBLISHED"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

// Same limits as the API (models/marketDocumentModel.js, marketReviewModel.js, marketReportModel.js).
export const TITLE_MIN_LENGTH = 3;
export const TITLE_MAX_LENGTH = 150;
export const DESCRIPTION_MAX_LENGTH = 3000;
export const PROFESSOR_MAX_LENGTH = 100;
export const MIN_PRICE = 0;
export const MAX_PRICE = 50;
export const LEVELS = [1, 2, 3, 4, 5] as const;
export const RATINGS = [1, 2, 3, 4, 5] as const;
export const COMMENT_MAX_LENGTH = 1000;
export const REPORT_REASON_MIN_LENGTH = 5;
export const REPORT_REASON_MAX_LENGTH = 500;
/** Rejection (required) and unpublication (optional) reasons. */
export const DECISION_REASON_MIN_LENGTH = 3;
export const DECISION_REASON_MAX_LENGTH = 500;
export const NOTE_MAX_LENGTH = 500;
export const SEARCH_MAX_LENGTH = 200;
/** Default of MAX_UPLOAD_MB (GET /config gives the server's value). */
export const DEFAULT_MAX_UPLOAD_MB = 10;

/** Accepted files: extension -> MIME type (the API checks MIME type, extension and content). */
export const FILE_TYPES: Readonly<Record<string, string>> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
/** `accept` attribute of the file input. */
export const FILE_ACCEPT = [...Object.keys(FILE_TYPES), ...new Set(Object.values(FILE_TYPES))].join(",");

/** ".PDF" of "Notes.PDF" (lowercase), "" without extension. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

export const isAcceptedFile = (name: string) => fileExtension(name) in FILE_TYPES;

/** `{ id, firstname, lastname }`; null when unknown. Never an email. */
export type MarketPerson = { id: string; firstname: string; lastname: string } | null;

export type MarketDocument = {
  id: string;
  title: string;
  /** Plain text: keep the line breaks, never render it as HTML. */
  description: string;
  /** null when the subject was deleted. */
  subject: Subject | null;
  level: number | null;
  academicYear: string | null;
  professor: string | null;
  type: DocumentType;
  file: { filename: string; size: number; mimeType: string } | null;
  /** Tokens, 0 = free. */
  price: number;
  author: MarketPerson;
  status: DocumentStatus;
  /** Reason of the last rejection or unpublication (author and ADMINs, REJECTED / UNPUBLISHED only). */
  rejectionReason: string | null;
  rating: number;
  ratingCount: number;
  downloads: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** The viewer bought it (premium) or downloaded it (free). */
  purchased?: boolean;
  /** The viewer is the author. */
  mine?: boolean;
  canDownload?: boolean;
  /** Detail, upload, edit, purchase and moderation answers only. */
  canReview?: boolean;
};

export type DocumentList = Paginated<MarketDocument>;

export type TransactionType = "STARTING_BONUS" | "PURCHASE" | "SALE";

export type WalletTransaction = {
  id: string;
  type: TransactionType;
  /** Signed: negative for a purchase. */
  amount: number;
  balanceAfter: number;
  document: { id: string; title: string } | null;
  createdAt: string;
};

/** GET /api/marketplace/wallet?page&limit */
export type Wallet = { balance: number; transactions: WalletTransaction[]; total: number; page: number; limit: number };

export type Review = {
  id: string;
  documentId: string;
  author: MarketPerson;
  rating: number;
  /** Plain text. */
  comment: string;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
};

export type RatingDistribution = Record<"1" | "2" | "3" | "4" | "5", number>;

/** GET /api/marketplace/documents/:id/reviews */
export type ReviewList = Paginated<Review> & { myReview: Review | null; canReview: boolean; distribution: RatingDistribution };

export type PurchaseResult = {
  purchase: { id: string; documentId: string; kind: string; price: number; state: string; createdAt: string };
  balance: number;
  document: MarketDocument;
};

export type ReportStatus = "OPEN" | "RESOLVED";
export type ReportOutcome = "UNPUBLISHED" | "NO_ACTION";

/** Report as ADMINs see it (GET /api/marketplace/reports). */
export type MarketReport = {
  id: string;
  documentId: string;
  document: { id: string; title: string; status: DocumentStatus; price: number; author: MarketPerson } | null;
  reason: string;
  status: ReportStatus;
  outcome: ReportOutcome | null;
  note: string | null;
  reporter: { id: string; firstname: string; lastname: string; role: Role | null } | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: MarketPerson;
};

export type ReportList = Paginated<MarketReport> & { openCount: number };

/** GET /api/marketplace/config */
export type MarketConfig = {
  startingTokens: number;
  minPrice: number;
  maxPrice: number;
  maxUploadMb: number;
  allowedExtensions: string[];
  allowedMimeTypes: string[];
  types: string[];
  statuses: string[];
};

const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;

export function isObjectId(value: unknown): value is string {
  return typeof value === "string" && OBJECT_ID_RE.test(value);
}

export const isDocumentType = (value: unknown): value is DocumentType => (DOCUMENT_TYPES as readonly unknown[]).includes(value);
export const isDocumentStatus = (value: unknown): value is DocumentStatus => (DOCUMENT_STATUSES as readonly unknown[]).includes(value);

export function isMarketDocument(value: unknown): value is MarketDocument {
  const doc = value as MarketDocument | null;
  return !!doc && typeof doc === "object" && typeof doc.id === "string" && typeof doc.title === "string" && typeof doc.price === "number";
}

export function isDocumentList(value: unknown): value is DocumentList {
  const list = value as DocumentList | null;
  return !!list && typeof list === "object" && Array.isArray(list.items);
}

export function isWallet(value: unknown): value is Wallet {
  const wallet = value as Wallet | null;
  return !!wallet && typeof wallet === "object" && typeof wallet.balance === "number" && Array.isArray(wallet.transactions);
}

export function isReviewList(value: unknown): value is ReviewList {
  const list = value as ReviewList | null;
  return !!list && typeof list === "object" && Array.isArray(list.items);
}

/** "2026-2027" of a date (campus academic year: September to August). */
export function academicYearOf(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "numeric" }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? date.getUTCFullYear());
  const month = Number(parts.find((part) => part.type === "month")?.value ?? 1);
  const start = month >= 9 ? year : year - 1;
  return `${start}-${start + 1}`;
}

/** The current academic year and the `count - 1` previous ones, newest first. */
export function recentAcademicYears(current: string, count = 5): string[] {
  const start = Number(current.slice(0, 4));
  return Array.from({ length: count }, (_, index) => `${start - index}-${start - index + 1}`);
}

export const ACADEMIC_YEAR_RE = /^(\d{4})-(\d{4})$/;

export function isAcademicYear(value: string): boolean {
  const match = ACADEMIC_YEAR_RE.exec(value);
  return !!match && Number(match[2]) === Number(match[1]) + 1;
}
