// URL state of /dashboard/alumni: the tab and the directory filters (`?tab&q&program&promotion&sector&skill&mentoring&sort`).
import type { Role } from "@/lib/types";
import { isObjectId, SEARCH_MAX_LENGTH, SECTOR_MAX_LENGTH, SKILL_MAX_LENGTH } from "@/lib/alumni/types";

export const DIRECTORY_SORTS = ["name", "recent", "promotion"] as const;
export type DirectorySort = (typeof DIRECTORY_SORTS)[number];

export type DirectoryFilters = {
  q: string;
  /** Program id. */
  program: string;
  /** Graduation year ("2019"). */
  promotion: string;
  sector: string;
  skill: string;
  /** Only alumni open to mentoring. */
  mentoring: boolean;
  sort: DirectorySort;
};

export const EMPTY_DIRECTORY_FILTERS: DirectoryFilters = {
  q: "",
  program: "",
  promotion: "",
  sector: "",
  skill: "",
  mentoring: false,
  sort: "name",
};

/** Tabs of /dashboard/alumni ("mentoring" for students, "support" for admins). */
export const ALUMNI_TABS = ["directory", "news", "mentoring", "support"] as const;
export type AlumniTab = (typeof ALUMNI_TABS)[number];

export function tabsFor(role: Role): AlumniTab[] {
  if (role === "STUDENT") return ["directory", "news", "mentoring"];
  if (role === "ADMIN") return ["directory", "news", "support"];
  return ["directory", "news"];
}

type Source = URLSearchParams | Record<string, string | string[] | undefined>;

function read(source: Source, name: string): string {
  if (source instanceof URLSearchParams) return source.get(name) ?? "";
  const value = source[name];
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

const oneLine = (value: string, max: number) => value.replace(/\s+/g, " ").trim().slice(0, max);

/** Filters of the address, cleaned (unknown values are dropped). */
export function parseDirectoryFilters(source: Source): DirectoryFilters {
  const program = read(source, "program");
  const promotion = read(source, "promotion");
  const sort = read(source, "sort");
  const mentoring = read(source, "mentoring");
  return {
    q: oneLine(read(source, "q"), SEARCH_MAX_LENGTH),
    program: isObjectId(program) ? program : "",
    promotion: /^\d{4}$/.test(promotion) ? promotion : "",
    sector: oneLine(read(source, "sector"), SECTOR_MAX_LENGTH),
    skill: oneLine(read(source, "skill"), SKILL_MAX_LENGTH),
    mentoring: mentoring === "true" || mentoring === "1",
    sort: (DIRECTORY_SORTS as readonly string[]).includes(sort) ? (sort as DirectorySort) : "name",
  };
}

/** The tab of the address: `?tab=`, else "#mentoring" (notification links) for students, else the directory. */
export function parseTab(source: Source, role: Role, hash = ""): AlumniTab {
  const allowed = tabsFor(role);
  const tab = read(source, "tab");
  if ((allowed as string[]).includes(tab)) return tab as AlumniTab;
  if (hash === "#mentoring" && allowed.includes("mentoring")) return "mentoring";
  return "directory";
}

/** Tabs of /dashboard/alumni/me (ALUMNI). */
export const ME_TABS = ["profile", "mentoring", "posts", "data"] as const;
export type MeTab = (typeof ME_TABS)[number];

/** `?tab=`, else "#mentoring" (notification links of new requests), else "profile". */
export function parseMeTab(source: Source, hash = ""): MeTab {
  const tab = read(source, "tab");
  if ((ME_TABS as readonly string[]).includes(tab)) return tab as MeTab;
  return hash === "#mentoring" ? "mentoring" : "profile";
}

export function isDirectoryFiltered(filters: DirectoryFilters): boolean {
  return !!(filters.q || filters.program || filters.promotion || filters.sector || filters.skill || filters.mentoring);
}

/** Query string of the page: the tab (not the default one) then the directory filters that are set. */
export function alumniSearch(tab: AlumniTab, filters: DirectoryFilters): string {
  const params = new URLSearchParams();
  if (tab !== "directory") params.set("tab", tab);
  if (filters.q) params.set("q", filters.q);
  if (filters.program) params.set("program", filters.program);
  if (filters.promotion) params.set("promotion", filters.promotion);
  if (filters.sector) params.set("sector", filters.sector);
  if (filters.skill) params.set("skill", filters.skill);
  if (filters.mentoring) params.set("mentoring", "true");
  if (filters.sort !== "name") params.set("sort", filters.sort);
  return params.toString();
}

/** Same filters, compared as a whole (query keys, remounts). */
export function filtersKey(filters: DirectoryFilters): string {
  return alumniSearch("directory", filters);
}
