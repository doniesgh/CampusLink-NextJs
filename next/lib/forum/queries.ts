// Offline-first reads shared by the forum pages (Client Components only).
import { useOfflineQuery } from "@/lib/offline";
import { LEADERBOARD_KEY, LEADERBOARD_PATH, SUBJECTS_KEY, SUBJECTS_PATH, tagsKey, tagsPath } from "@/lib/forum/paths";
import type { Leaderboard, TagCount } from "@/lib/forum/types";
import type { Subject } from "@/lib/types";

/** Server-rendered data handed to a hook: `{ data, savedAt }` (serverSnapshot), data null on failure. */
export type Snapshot<T> = { data: T | null; savedAt: number } | null;

const seed = <T>(snapshot: Snapshot<T> | undefined) => ({
  fallbackData: snapshot?.data ?? undefined,
  fallbackSavedAt: snapshot?.savedAt,
  revalidateOnMount: !snapshot?.data,
});

/** Subjects of the filters and of the ask / edit form (GET /api/academic/subjects, saved for offline use). */
export function useForumSubjects(initial?: Snapshot<Subject[]>, enabled = true): Subject[] {
  const { data } = useOfflineQuery<Subject[]>(SUBJECTS_KEY, enabled ? SUBJECTS_PATH : null, { ...seed(initial), reportLastUpdated: false });
  return Array.isArray(data) ? data : [];
}

/** Most used tags (of a subject when one is chosen): options of the "Tag" filter. */
export function useForumTags(subject: string, initial?: Snapshot<TagCount[]>): TagCount[] {
  const { data } = useOfflineQuery<TagCount[]>(tagsKey(subject), tagsPath(subject), { ...seed(initial), reportLastUpdated: false });
  return Array.isArray(data) ? data : [];
}

/** Top helpers of the current academic year. */
export function useLeaderboard(initial?: Snapshot<Leaderboard>) {
  return useOfflineQuery<Leaderboard>(LEADERBOARD_KEY, LEADERBOARD_PATH, { ...seed(initial), reportLastUpdated: false });
}
