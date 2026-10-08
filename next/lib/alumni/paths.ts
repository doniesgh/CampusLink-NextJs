// Web pages, API paths and offline query keys of the alumni network (IndexedDB keys start with "alumni").
import { alumniSearch, EMPTY_DIRECTORY_FILTERS, filtersKey, type AlumniTab, type DirectoryFilters } from "@/lib/alumni/filters";
import type { MentoringRole, MentoringStatus, PostType, Visibility } from "@/lib/alumni/types";

export const DIRECTORY_PAGE_SIZE = 12;
export const POSTS_PAGE_SIZE = 10;
export const MENTORING_PAGE_SIZE = 20;
export const SUPPORT_PAGE_SIZE = 20;
export const PROFILE_POSTS_LIMIT = 3;

// ---- Web pages
export const alumniHref = "/dashboard/alumni";
export const myProfileHref = "/dashboard/alumni/me";
/** Notification links: "/dashboard/alumni#mentoring" (mentee), "/dashboard/alumni/me#mentoring" (mentor). */
export const MENTORING_ANCHOR = "mentoring";
export const profileHref = (id: string) => `${alumniHref}/${encodeURIComponent(id)}`;

/** /dashboard/alumni with a tab and directory filters, e.g. "/dashboard/alumni?skill=Python". */
export function alumniPageHref(tab: AlumniTab = "directory", filters: Partial<DirectoryFilters> = {}): string {
  const query = alumniSearch(tab, { ...EMPTY_DIRECTORY_FILTERS, ...filters });
  return query ? `${alumniHref}?${query}` : alumniHref;
}

/** GET /bff/alumni/me/export answers with Content-Disposition: attachment (a plain download link). */
export const EXPORT_HREF = "/bff/alumni/me/export";

// ---- API paths (relative to /api, through the BFF in the browser)
export const MY_PROFILE_PATH = "/alumni/me";
export const FACETS_PATH = "/alumni/facets";
export const PROGRAMS_PATH = "/academic/programs";
export const profilePath = (id: string) => `/alumni/${encodeURIComponent(id)}`;

export function directoryPath(filters: DirectoryFilters, page: number): string {
  const params = new URLSearchParams({ page: String(page), limit: String(DIRECTORY_PAGE_SIZE), sort: filters.sort });
  if (filters.q) params.set("q", filters.q);
  if (filters.program) params.set("program", filters.program);
  if (filters.promotion) params.set("promotion", filters.promotion);
  if (filters.sector) params.set("sector", filters.sector);
  if (filters.skill) params.set("skill", filters.skill);
  if (filters.mentoring) params.set("mentoring", "true");
  return `/alumni?${params}`;
}

/** "active" = PENDING + ACCEPTED, "past" = DECLINED + CLOSED. */
export const MENTORING_VIEWS = ["active", "past", "all"] as const;
export type MentoringView = (typeof MENTORING_VIEWS)[number];

export const VIEW_STATUSES: Record<MentoringView, MentoringStatus[]> = {
  active: ["PENDING", "ACCEPTED"],
  past: ["DECLINED", "CLOSED"],
  all: [],
};

export function mentoringPath(role: MentoringRole, view: MentoringView, page: number, limit = MENTORING_PAGE_SIZE): string {
  const params = new URLSearchParams({ role, page: String(page), limit: String(limit) });
  const statuses = VIEW_STATUSES[view];
  if (statuses.length > 0) params.set("status", statuses.join(","));
  return `/alumni/mentoring?${params}`;
}

/** PENDING requests of the signed-in student (badge, limit of 3). */
export const PENDING_MENTEE_PATH = "/alumni/mentoring?role=mentee&status=PENDING&limit=1";

export type PostFilters = { type: PostType | ""; author: string; hidden: "" | "true" | "false" };
export const EMPTY_POST_FILTERS: PostFilters = { type: "", author: "", hidden: "" };

export function postsPath(filters: PostFilters, page: number, limit = POSTS_PAGE_SIZE): string {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filters.type) params.set("type", filters.type);
  if (filters.author) params.set("author", filters.author);
  if (filters.hidden) params.set("hidden", filters.hidden);
  return `/alumni/posts?${params}`;
}

export type SupportFilters = { q: string; visibility: Visibility | ""; mentoring: "" | "true" | "false" };
export const EMPTY_SUPPORT_FILTERS: SupportFilters = { q: "", visibility: "", mentoring: "" };

export function supportPath(filters: SupportFilters, page: number): string {
  const params = new URLSearchParams({ page: String(page), limit: String(SUPPORT_PAGE_SIZE) });
  if (filters.q) params.set("q", filters.q);
  if (filters.visibility) params.set("visibility", filters.visibility);
  if (filters.mentoring) params.set("mentoring", filters.mentoring);
  return `/alumni/admin/profiles?${params}`;
}

export const mentoringRequestPath = (id: string) => `/alumni/mentoring/${encodeURIComponent(id)}`;
export const postPath = (id: string) => `/alumni/posts/${encodeURIComponent(id)}`;

// ---- Offline query keys (useOfflineQuery); invalidateQueries("alumni") refreshes every mounted one.
export const directoryKey = (filters: DirectoryFilters, page: number) => ["alumni", "directory", filtersKey(filters), page] as const;
export const FACETS_KEY = ["alumni", "facets"] as const;
export const PROGRAMS_KEY = ["alumni", "programs"] as const;
export const MY_PROFILE_KEY = ["alumni", "me"] as const;
export const profileKey = (id: string) => ["alumni", "profile", id] as const;
export const mentoringKey = (role: MentoringRole, view: MentoringView, page: number) => ["alumni", "mentoring", role, view, page] as const;
export const PENDING_MENTEE_KEY = ["alumni", "mentoring", "pending"] as const;
export const postsKey = (filters: PostFilters, page: number, limit = POSTS_PAGE_SIZE) =>
  ["alumni", "posts", filters.type, filters.author, filters.hidden, page, limit] as const;
