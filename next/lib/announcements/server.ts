import "server-only";
import { cache } from "react";
import { toApiError, type ApiError } from "@/lib/api";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverApi } from "@/lib/server-api";
import { ROLES, type Group, type Program, type Role, type User } from "@/lib/types";
import { detailPath } from "@/lib/announcements/paths";
import { isAnnouncement, LEVELS, type Announcement } from "@/lib/announcements/types";

/** What the composer's "Audience" fieldset offers to the signed-in author. */
export type AudienceOptions = {
  roles: Role[];
  programs: { id: string; name: string; code: string }[];
  levels: number[];
  groups: { id: string; name: string; level: number; academicYear: string; programCode: string }[];
  /** TEACHER: only the groups they teach, roles [] or ["STUDENT"] (else 403 AUDIENCE_NOT_ALLOWED). */
  teacherRestricted: boolean;
};

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, undefined, { numeric: true });

function toGroupOption(group: Group) {
  return {
    id: group.id,
    name: group.name,
    level: group.level,
    academicYear: group.academicYear,
    programCode: group.program?.code ?? "",
  };
}

/**
 * ADMIN: every role, program, level 1..5 and group (/api/academic). TEACHER: "Student" only, and the
 * groups they teach (/api/timetable/me/groups) with their programs and levels.
 */
export async function loadAudienceOptions(user: User): Promise<{ options: AudienceOptions; error: string | null }> {
  const empty: AudienceOptions = { roles: [], programs: [], levels: [], groups: [], teacherRestricted: user.role !== "ADMIN" };
  try {
    if (user.role === "ADMIN") {
      const [programs, groups] = await Promise.all([
        serverApi<Program[]>("/academic/programs"),
        serverApi<Group[]>("/academic/groups"),
      ]);
      return {
        options: {
          roles: [...ROLES],
          programs: (Array.isArray(programs) ? programs : []).map(({ id, name, code }) => ({ id, name, code })).sort(byName),
          levels: [...LEVELS],
          groups: (Array.isArray(groups) ? groups : []).map(toGroupOption).sort(byName),
          teacherRestricted: false,
        },
        error: null,
      };
    }

    const taught = await serverApi<Group[]>("/timetable/me/groups");
    const groups = (Array.isArray(taught) ? taught : []).map(toGroupOption).sort(byName);
    const programs = new Map<string, { id: string; name: string; code: string }>();
    for (const group of Array.isArray(taught) ? taught : []) {
      if (group.program?.id) programs.set(group.program.id, { id: group.program.id, name: group.program.name, code: group.program.code });
    }
    return {
      options: {
        roles: ["STUDENT"],
        programs: [...programs.values()].sort(byName),
        levels: [...new Set(groups.map((group) => group.level))].filter((level) => Number.isInteger(level)).sort((a, b) => a - b),
        groups,
        teacherRestricted: true,
      },
      error: null,
    };
  } catch (e) {
    const formatter = await getErrorFormatter();
    return { options: empty, error: formatter.message(toApiError(e)) };
  }
}

export type LoadedAnnouncement = { data: Announcement; error?: undefined } | { data?: undefined; error: ApiError };

/** GET /api/announcements/:id as the signed-in manager (with `stats`), memoised per request. */
export const loadManagedAnnouncement = cache(async (id: string): Promise<LoadedAnnouncement> => {
  try {
    const data = await serverApi<Announcement>(detailPath(id));
    if (!isAnnouncement(data)) return { error: toApiError(new Error("Unexpected answer")) };
    return { data };
  } catch (e) {
    return { error: toApiError(e) };
  }
});

/** 404 / 403 / invalid id: shown as "not found" (never reveals whether it exists). */
export function isMissingError(error: ApiError): boolean {
  return error.status === 404 || error.status === 403 || error.status === 400;
}
