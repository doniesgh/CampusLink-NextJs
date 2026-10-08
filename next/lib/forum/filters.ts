// Filters of the question list, kept in the URL of /dashboard/forum (?q&subject&level&tag&sort).
// Usable from Server and Client Components.
import { isObjectId, LEVELS, TAG_MAX_LENGTH, TITLE_MAX_LENGTH, type Question } from "@/lib/forum/types";

export const SORTS = ["relevance", "recent", "votes", "activity", "unanswered"] as const;
export type ForumSort = (typeof SORTS)[number];

/**
 * Empty strings mean "no filter". `sort` "" is the API default: "relevance" with a search, else "recent".
 * "unanswered" is shown as the "Unanswered only" checkbox (the API keeps the questions without a visible
 * answer, newest first).
 */
export type ForumFilters = { q: string; subject: string; level: string; tag: string; sort: ForumSort | "" };

export const EMPTY_FILTERS: ForumFilters = { q: "", subject: "", level: "", tag: "", sort: "" };

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function read(source: ParamSource, name: string): string {
  const value = source instanceof URLSearchParams ? source.get(name) : source[name];
  return ((Array.isArray(value) ? value[0] : value) ?? "").trim();
}

/** Valid tag value for the filter (lowercase, same characters as the API), or "". */
export function normalizeTag(value: string): string {
  const tag = value.trim().toLowerCase().replace(/\s+/g, "-");
  return tag.length > 0 && tag.length <= TAG_MAX_LENGTH && /^[\p{L}\p{N}+#._-]+$/u.test(tag) ? tag : "";
}

/** Reads (and cleans) the filters of a URL: unknown values are dropped. */
export function parseFilters(source: ParamSource): ForumFilters {
  const q = read(source, "q").replace(/\s+/g, " ").slice(0, TITLE_MAX_LENGTH);
  const subject = read(source, "subject");
  const level = read(source, "level");
  const sort = read(source, "sort").toLowerCase();
  return normalizeFilters({
    q,
    subject: isObjectId(subject) ? subject : "",
    level: (LEVELS as readonly number[]).includes(Number(level)) ? String(Number(level)) : "",
    tag: normalizeTag(read(source, "tag")),
    sort: (SORTS as readonly string[]).includes(sort) ? (sort as ForumSort) : "",
  });
}

/** "relevance" only makes sense with a search; it is also the default then. */
export function normalizeFilters(filters: ForumFilters): ForumFilters {
  const q = filters.q.trim();
  let sort = filters.sort;
  if (sort === "relevance" && !q) sort = "";
  if (sort === "recent" && !q) sort = "";
  return { ...filters, q, sort };
}

/** Query string of the page URL (only the filters that are set). */
export function filtersToSearch(filters: ForumFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const name of ["q", "subject", "level", "tag", "sort"] as const) {
    if (filters[name]) params.set(name, filters[name]);
  }
  return params;
}

export function isFiltered(filters: ForumFilters): boolean {
  return Object.values(filters).some(Boolean);
}

/** Sort applied by the API for these filters (for the "Sort by" select). */
export function effectiveSort(filters: ForumFilters): ForumSort {
  if (filters.sort) return filters.sort;
  return filters.q ? "relevance" : "recent";
}

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * Offline fallback when a filter combination was never loaded on this device: the saved questions are
 * filtered here (every word of the search must appear in the title, the body or the tags).
 */
export function matchesLocally(question: Question, filters: ForumFilters): boolean {
  if (filters.subject && question.subject?.id !== filters.subject) return false;
  if (filters.level && String(question.level ?? "") !== filters.level) return false;
  if (filters.tag && !question.tags.includes(filters.tag)) return false;
  if (filters.sort === "unanswered" && question.answerCount > 0) return false;
  if (filters.q) {
    const haystack = fold(`${question.title} ${question.body} ${question.tags.join(" ")}`);
    const words = fold(filters.q)
      .split(/[\s"]+/)
      .filter((word) => word.length > 0 && !word.startsWith("-"));
    if (!words.every((word) => haystack.includes(word))) return false;
  }
  return true;
}

/** Local sort of the offline fallback (same orders as the API, "relevance" keeps the saved order). */
export function sortLocally(questions: Question[], filters: ForumFilters): Question[] {
  const time = (value: string | null | undefined) => (value ? new Date(value).getTime() || 0 : 0);
  const sorted = [...questions];
  switch (effectiveSort(filters)) {
    case "votes":
      return sorted.sort((a, b) => b.score - a.score || time(b.createdAt) - time(a.createdAt));
    case "activity":
      return sorted.sort((a, b) => time(b.lastActivityAt) - time(a.lastActivityAt));
    case "recent":
    case "unanswered":
      return sorted.sort((a, b) => time(b.createdAt) - time(a.createdAt));
    default:
      return sorted;
  }
}
