"use client";

// Browser-side helpers of the alumni pages: the "#mentoring" anchor of notification links and the offline-first
// reads shared by several components.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { BffError, bffFetch, useOfflineQuery } from "@/lib/offline";
import { FACETS_KEY, FACETS_PATH, PENDING_MENTEE_KEY, PENDING_MENTEE_PATH, PROGRAMS_KEY, PROGRAMS_PATH } from "@/lib/alumni/paths";
import { isFacets, type Facets, type MentoringList } from "@/lib/alumni/types";
import type { Program } from "@/lib/types";

/** Server-rendered data handed to a hook: `{ data, savedAt }` (serverSnapshot), data null on failure. */
export type Snapshot<T> = { data: T | null; savedAt: number } | null;

export const seed = <T>(snapshot: Snapshot<T> | undefined) => ({
  fallbackData: snapshot?.data ?? undefined,
  fallbackSavedAt: snapshot?.savedAt,
  revalidateOnMount: !snapshot?.data,
});

// setSearch() of lib/timetable/client.ts announces its changes with this event.
const URL_EVENT = "campuslink:url-change";

function subscribeHash(listener: () => void): () => void {
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  window.addEventListener(URL_EVENT, listener);
  return () => {
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("popstate", listener);
    window.removeEventListener(URL_EVENT, listener);
  };
}

/** `window.location.hash` ("#mentoring"), "" while hydrating (the server never sees the anchor). */
export function useLocationHash(): string {
  return useSyncExternalStore(
    subscribeHash,
    () => window.location.hash,
    () => ""
  );
}

/** Current query string (without "?"); `serverSearch` (what the server rendered) while hydrating. */
export function useLocationSearch(serverSearch: string): string {
  return useSyncExternalStore(
    subscribeHash,
    () => window.location.search.replace(/^\?/, ""),
    () => serverSearch
  );
}

/**
 * Replaces the query string (and drops the "#mentoring" anchor) without a server round trip: Next.js keeps its
 * router in sync with the History API. Tabs and filters replace the entry, so Back leaves the page.
 */
export function replaceSearch(query: string): void {
  const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` === url) return;
  window.history.replaceState(window.history.state, "", url);
  window.dispatchEvent(new Event(URL_EVENT));
}

/** Filter values of the directory (GET /api/alumni/facets), saved for offline use. */
export function useFacets(initial?: Snapshot<Facets>): Facets | null {
  const { data } = useOfflineQuery<Facets>(FACETS_KEY, FACETS_PATH, { ...seed(initial), reportLastUpdated: false });
  return isFacets(data) ? data : null;
}

/** Programs of the profile form (GET /api/academic/programs). */
export function usePrograms(initial?: Snapshot<Program[]>): Program[] {
  const { data } = useOfflineQuery<Program[]>(PROGRAMS_KEY, PROGRAMS_PATH, { ...seed(initial), reportLastUpdated: false });
  return Array.isArray(data) ? data : [];
}

type LiveState<T> = { path: string | null; data?: T; error: BffError | null };

/**
 * Online-only read through the BFF, never saved on the device (the ADMIN support list holds private profiles):
 * `{ data, error, isLoading, refresh }` for `path` (null disables it).
 */
export function useLiveQuery<T>(path: string | null) {
  const [state, setState] = useState<LiveState<T>>({ path: null, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    bffFetch<T>(path).then(
      (data) => {
        if (!cancelled) setState({ path, data, error: null });
      },
      (error: unknown) => {
        if (!cancelled) setState({ path, error: error instanceof BffError ? error : new BffError(0, "NETWORK_ERROR", "Can't reach the server.") });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [path, attempt]);
  const current: LiveState<T> = state.path === path ? state : { path, error: null };
  const refresh = useCallback(() => setAttempt((count) => count + 1), []);
  return { data: current.data, error: current.error, isLoading: !!path && current.data === undefined && !current.error, refresh };
}

/** PENDING requests of the signed-in student: `null` while unknown (the limit is 3). */
export function usePendingMenteeCount(initial?: Snapshot<MentoringList>, enabled = true): number | null {
  const { data } = useOfflineQuery<MentoringList>(PENDING_MENTEE_KEY, enabled ? PENDING_MENTEE_PATH : null, {
    ...seed(initial),
    reportLastUpdated: false,
  });
  return typeof data?.pendingCount === "number" ? data.pendingCount : null;
}
