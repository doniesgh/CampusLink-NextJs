// Web pages, API paths (relative to /api, through the BFF in the browser) and offline query keys of the
// marketplace (IndexedDB keys start with "marketplace").
import { effectiveSort, type BrowseFilters } from "@/lib/marketplace/filters";
import type { DocumentStatus, ReportStatus } from "@/lib/marketplace/types";

export const BROWSE_PAGE_SIZE = 12;
export const MINE_PAGE_SIZE = 10;
export const WALLET_PAGE_SIZE = 20;
export const REVIEWS_PAGE_SIZE = 10;
export const ADMIN_PAGE_SIZE = 20;

// ---- Web pages
export const marketplaceHref = "/dashboard/marketplace";
export const documentHref = (id: string) => `${marketplaceHref}/${encodeURIComponent(id)}`;
export const moderationHref = "/dashboard/admin/marketplace";
/** Download link through the BFF (the API answers with Content-Disposition: attachment). */
export const fileHref = (id: string) => `/bff/marketplace/documents/${encodeURIComponent(id)}/file`;

// ---- API paths
export const CONFIG_PATH = "/marketplace/config";
export const SUBJECTS_PATH = "/academic/subjects";
export const walletPath = (page: number) => `/marketplace/wallet?page=${page}&limit=${WALLET_PAGE_SIZE}`;
export const documentPath = (id: string) => `/marketplace/documents/${encodeURIComponent(id)}`;
export const reviewsPath = (id: string, page: number) => `${documentPath(id)}/reviews?page=${page}&limit=${REVIEWS_PAGE_SIZE}`;

export function documentsPath(filters: BrowseFilters, page: number): string {
  const params = new URLSearchParams({ page: String(page), limit: String(BROWSE_PAGE_SIZE) });
  if (filters.q) params.set("q", filters.q);
  if (filters.subject) params.set("subject", filters.subject);
  if (filters.type) params.set("type", filters.type);
  if (filters.level) params.set("level", filters.level);
  if (filters.price) params.set("free", filters.price === "free" ? "true" : "false");
  if (filters.professor) params.set("professor", filters.professor);
  if (filters.year) params.set("academicYear", filters.year);
  params.set("sort", effectiveSort(filters));
  return `/marketplace/documents?${params}`;
}

/** My uploads, every status (or one). */
export function myDocumentsPath(status: DocumentStatus | "", page: number): string {
  const params = new URLSearchParams({ mine: "true", page: String(page), limit: String(MINE_PAGE_SIZE) });
  if (status) params.set("status", status);
  return `/marketplace/documents?${params}`;
}

/** Documents I bought or downloaded (published ones). */
export const libraryPath = (page: number) => `/marketplace/documents?purchased=true&page=${page}&limit=${MINE_PAGE_SIZE}`;

// ---- Moderation (ADMIN, server-rendered)
export const queuePath = (page: number) =>
  `/marketplace/documents?status=PENDING_REVIEW&sort=oldest&page=${page}&limit=${ADMIN_PAGE_SIZE}`;
export const unpublishedPath = (page: number) => `/marketplace/documents?status=UNPUBLISHED&page=${page}&limit=${ADMIN_PAGE_SIZE}`;
export const reportsPath = (status: ReportStatus, page: number) => `/marketplace/reports?status=${status}&page=${page}&limit=${ADMIN_PAGE_SIZE}`;

// ---- Offline query keys (useOfflineQuery)
export const listKey = (filters: BrowseFilters, page: number) =>
  [
    "marketplace",
    "list",
    filters.q,
    filters.subject,
    filters.type,
    filters.level,
    filters.price,
    filters.professor,
    filters.year,
    effectiveSort(filters),
    page,
  ] as const;
export const mineKey = (status: DocumentStatus | "", page: number) => ["marketplace", "mine", status, page] as const;
export const libraryKey = (page: number) => ["marketplace", "library", page] as const;
export const walletKey = (page: number) => ["marketplace", "wallet", page] as const;
export const documentKey = (id: string) => ["marketplace", "document", id] as const;
export const reviewsKey = (id: string, page: number) => ["marketplace", "reviews", id, page] as const;
export const SUBJECTS_KEY = ["marketplace", "subjects"] as const;
export const CONFIG_KEY = ["marketplace", "config"] as const;
