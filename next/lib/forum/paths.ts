// Web pages, API paths and offline query keys of the forum (IndexedDB keys start with "forum").
import { effectiveSort, filtersToSearch, type ForumFilters } from "@/lib/forum/filters";

export const FORUM_PAGE_SIZE = 20;
export const LEADERBOARD_LIMIT = 5;
export const TAGS_LIMIT = 30;
export const REPORTS_PAGE_SIZE = 20;

// ---- Web pages
export const forumHref = "/dashboard/forum";
export const questionHref = (id: string) => `${forumHref}/${encodeURIComponent(id)}`;
/** Notification links use the same anchor: each answer element has id="answer-<id>". */
export const answerHref = (questionId: string, answerId: string) => `${questionHref(questionId)}#answer-${encodeURIComponent(answerId)}`;
export const profileHref = (userId: string) => `${forumHref}/profile/${encodeURIComponent(userId)}`;
export const moderationHref = "/dashboard/admin/forum";

/** The list with these filters, e.g. "/dashboard/forum?tag=sql". */
export function listHref(filters: Partial<ForumFilters> = {}): string {
  const query = filtersToSearch({ q: "", subject: "", level: "", tag: "", sort: "", ...filters }).toString();
  return query ? `${forumHref}?${query}` : forumHref;
}

// ---- API paths (relative to /api, through the BFF in the browser)
export function questionsPath(filters: ForumFilters, page: number): string {
  const params = new URLSearchParams({ page: String(page), limit: String(FORUM_PAGE_SIZE) });
  if (filters.q) params.set("q", filters.q);
  if (filters.subject) params.set("subject", filters.subject);
  if (filters.level) params.set("level", filters.level);
  if (filters.tag) params.set("tag", filters.tag);
  params.set("sort", effectiveSort(filters));
  return `/forum/questions?${params}`;
}

export const questionPath = (id: string) => `/forum/questions/${encodeURIComponent(id)}`;
export const answersPath = (questionId: string) => `${questionPath(questionId)}/answers`;
export const similarPath = (title: string) => `/forum/questions/similar?title=${encodeURIComponent(title)}`;
export const tagsPath = (subject: string) => `/forum/tags?limit=${TAGS_LIMIT}${subject ? `&subject=${encodeURIComponent(subject)}` : ""}`;
export const SUBJECTS_PATH = "/academic/subjects";
export const LEADERBOARD_PATH = `/forum/leaderboard?limit=${LEADERBOARD_LIMIT}`;
/** "me" is the signed-in user. */
export const profilePath = (userId: string) => (userId === "me" ? "/forum/profiles/me" : `/forum/profiles/${encodeURIComponent(userId)}`);
export const reportsPath = (status: "OPEN" | "RESOLVED", page: number) =>
  `/forum/reports?status=${status}&page=${page}&limit=${REPORTS_PAGE_SIZE}`;

// ---- Offline query keys (useOfflineQuery)
export const listKey = (filters: ForumFilters, page: number) =>
  ["forum", "list", filters.q, filters.subject, filters.level, filters.tag, effectiveSort(filters), page] as const;
export const DEFAULT_LIST_KEY = listKey({ q: "", subject: "", level: "", tag: "", sort: "" }, 1);
export const questionKey = (id: string) => ["forum", "question", id] as const;
export const SUBJECTS_KEY = ["forum", "subjects"] as const;
export const tagsKey = (subject: string) => ["forum", "tags", subject] as const;
export const LEADERBOARD_KEY = ["forum", "leaderboard"] as const;
