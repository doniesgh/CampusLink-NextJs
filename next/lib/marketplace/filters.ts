// URL state of /dashboard/marketplace: the tab, the search filters of "Browse" and the view of "My documents".
// Usable from Server and Client Components.
import {
  isAcademicYear,
  isDocumentStatus,
  isDocumentType,
  isObjectId,
  LEVELS,
  PROFESSOR_MAX_LENGTH,
  SEARCH_MAX_LENGTH,
  type DocumentStatus,
  type DocumentType,
  type MarketDocument,
} from "@/lib/marketplace/types";

export const TABS = ["browse", "mine", "wallet"] as const;
export type MarketTab = (typeof TABS)[number];

export const SORTS = ["relevance", "recent", "rating", "popular"] as const;
export type MarketSort = (typeof SORTS)[number];

export const PRICES = ["free", "premium"] as const;
export type PriceFilter = (typeof PRICES)[number];

export const MINE_VIEWS = ["shared", "library"] as const;
export type MineView = (typeof MINE_VIEWS)[number];

/** Empty strings mean "no filter". `sort` "" is the API default: "relevance" with a search, else "recent". */
export type BrowseFilters = {
  q: string;
  subject: string;
  type: DocumentType | "";
  level: string;
  price: PriceFilter | "";
  professor: string;
  year: string;
  sort: MarketSort | "";
};

export const EMPTY_FILTERS: BrowseFilters = { q: "", subject: "", type: "", level: "", price: "", professor: "", year: "", sort: "" };

export type MarketUrlState = {
  tab: MarketTab;
  filters: BrowseFilters;
  /** "My documents": what I shared (with a status filter) or what I bought / downloaded. */
  view: MineView;
  status: DocumentStatus | "";
  /** ?upload=1 opens the "Share a document" form. */
  upload: boolean;
};

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function read(source: ParamSource, name: string): string {
  const value = source instanceof URLSearchParams ? source.get(name) : source[name];
  return ((Array.isArray(value) ? value[0] : value) ?? "").trim();
}

const oneOf = <T extends string>(values: readonly T[], value: string): T | "" =>
  (values as readonly string[]).includes(value) ? (value as T) : "";

/** "relevance" only makes sense with a search (it is the default then), "recent" is the default otherwise. */
export function normalizeFilters(filters: BrowseFilters): BrowseFilters {
  const q = filters.q.replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX_LENGTH);
  const professor = filters.professor.replace(/\s+/g, " ").trim().slice(0, PROFESSOR_MAX_LENGTH);
  let sort = filters.sort;
  if (!q && (sort === "relevance" || sort === "recent")) sort = "";
  if (q && sort === "relevance") sort = "";
  return { ...filters, q, professor, sort };
}

export function parseFilters(source: ParamSource): BrowseFilters {
  const subject = read(source, "subject");
  const level = read(source, "level");
  const type = read(source, "type").toUpperCase();
  const year = read(source, "year");
  return normalizeFilters({
    q: read(source, "q"),
    subject: isObjectId(subject) ? subject : "",
    type: isDocumentType(type) ? type : "",
    level: (LEVELS as readonly number[]).includes(Number(level)) ? String(Number(level)) : "",
    price: oneOf(PRICES, read(source, "price").toLowerCase()),
    professor: read(source, "professor"),
    year: isAcademicYear(year) ? year : "",
    sort: oneOf(SORTS, read(source, "sort").toLowerCase()),
  });
}

export function parseMarketUrl(source: ParamSource): MarketUrlState {
  const status = read(source, "status").toUpperCase();
  return {
    tab: oneOf(TABS, read(source, "tab").toLowerCase()) || "browse",
    filters: parseFilters(source),
    view: oneOf(MINE_VIEWS, read(source, "view").toLowerCase()) || "shared",
    status: isDocumentStatus(status) ? status : "",
    upload: read(source, "upload") === "1",
  };
}

/** Query string of the page (only what differs from the defaults). */
export function marketSearch(state: MarketUrlState): string {
  const params = new URLSearchParams();
  if (state.tab !== "browse") params.set("tab", state.tab);
  if (state.tab === "browse") {
    for (const name of ["q", "subject", "type", "level", "price", "professor", "year", "sort"] as const) {
      if (state.filters[name]) params.set(name, state.filters[name]);
    }
  }
  if (state.tab === "mine") {
    if (state.view !== "shared") params.set("view", state.view);
    if (state.view === "shared" && state.status) params.set("status", state.status);
  }
  if (state.upload) params.set("upload", "1");
  return params.toString();
}

export function isFiltered(filters: BrowseFilters): boolean {
  return Object.values(filters).some(Boolean);
}

/** Sort applied by the API for these filters (value of the "Sort by" select). */
export function effectiveSort(filters: BrowseFilters): MarketSort {
  if (filters.sort) return filters.sort;
  return filters.q ? "relevance" : "recent";
}

/** Sorts offered by "Sort by" ("Best match" only with a search). */
export function sortOptions(filters: BrowseFilters): MarketSort[] {
  return filters.q ? ["relevance", "recent", "rating", "popular"] : ["recent", "rating", "popular"];
}

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * Offline fallback when a filter combination was never loaded on this device: the saved documents are filtered
 * here (every word of the search must appear in the title, the professor or the description).
 */
export function matchesLocally(doc: MarketDocument, filters: BrowseFilters): boolean {
  if (filters.subject && doc.subject?.id !== filters.subject) return false;
  if (filters.type && doc.type !== filters.type) return false;
  if (filters.level && String(doc.level ?? "") !== filters.level) return false;
  if (filters.price === "free" && doc.price !== 0) return false;
  if (filters.price === "premium" && doc.price === 0) return false;
  if (filters.year && doc.academicYear !== filters.year) return false;
  if (filters.professor && !fold(doc.professor ?? "").includes(fold(filters.professor))) return false;
  if (filters.q) {
    const haystack = fold(`${doc.title} ${doc.professor ?? ""} ${doc.description}`);
    const words = fold(filters.q)
      .split(/[\s"]+/)
      .filter((word) => word.length > 0 && !word.startsWith("-"));
    if (!words.every((word) => haystack.includes(word))) return false;
  }
  return true;
}

/** Local sort of the offline fallback (same orders as the API; "relevance" keeps the saved order). */
export function sortLocally(docs: MarketDocument[], filters: BrowseFilters): MarketDocument[] {
  const time = (value: string | null | undefined) => (value ? new Date(value).getTime() || 0 : 0);
  const sorted = [...docs];
  switch (effectiveSort(filters)) {
    case "rating":
      return sorted.sort((a, b) => b.rating - a.rating || b.ratingCount - a.ratingCount);
    case "popular":
      return sorted.sort((a, b) => b.downloads - a.downloads || b.rating - a.rating);
    case "recent":
      return sorted.sort((a, b) => time(b.publishedAt ?? b.createdAt) - time(a.publishedAt ?? a.createdAt));
    default:
      return sorted;
  }
}
