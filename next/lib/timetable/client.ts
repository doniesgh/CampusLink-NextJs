"use client";

// Browser-side helpers of the timetable views: URL state, media query, current time.
// They use useSyncExternalStore with a server snapshot, so the first (hydration) render always matches
// the server HTML, even when the service worker served a page saved for another URL while offline.
import { useSyncExternalStore } from "react";

const URL_EVENT = "campuslink:url-change";

function subscribeUrl(listener: () => void): () => void {
  window.addEventListener("popstate", listener);
  window.addEventListener(URL_EVENT, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(URL_EVENT, listener);
  };
}

/**
 * Current query string (without "?"). `serverSearch` is what the server rendered: it is used during
 * hydration, then the real URL takes over (back/forward and setSearch() included).
 */
export function useLocationSearch(serverSearch: string): string {
  return useSyncExternalStore(
    subscribeUrl,
    () => window.location.search.replace(/^\?/, ""),
    () => serverSearch
  );
}

/**
 * Updates the query string without a server round trip (Next.js keeps its router in sync with the
 * History API). `replace` for filters, push for periods/views so Back returns to the previous one.
 */
export function setSearch(query: string, { replace = false }: { replace?: boolean } = {}): void {
  const current = window.location.search.replace(/^\?/, "");
  if (current === query) return;
  const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  window.dispatchEvent(new Event(URL_EVENT));
}

/** `window.matchMedia(query).matches`, `serverValue` during hydration. */
export function useMediaQuery(query: string, serverValue: boolean): boolean {
  return useSyncExternalStore(
    (listener) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
    () => window.matchMedia(query).matches,
    () => serverValue
  );
}

// Current time, refreshed every 30 s (shared by every component using it).
const TICK_MS = 30_000;
let nowValue = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const nowListeners = new Set<() => void>();

/** Rounded down to the tick, so two reads close in time give the same snapshot. */
const roundNow = (ms: number) => Math.floor(ms / TICK_MS) * TICK_MS;

function readNow(): number {
  if (nowValue === 0) nowValue = roundNow(Date.now());
  return nowValue;
}

function subscribeNow(listener: () => void): () => void {
  nowListeners.add(listener);
  if (!timer) {
    nowValue = roundNow(Date.now());
    timer = setInterval(() => {
      nowValue = roundNow(Date.now());
      nowListeners.forEach((notify) => notify());
    }, TICK_MS);
  }
  return () => {
    nowListeners.delete(listener);
    if (nowListeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
      nowValue = 0;
    }
  };
}

/** Date.now() (ms, to the 30 s), updated every 30 s. `serverNow` (when the server rendered) is used during hydration. */
export function useNow(serverNow: number): number {
  return useSyncExternalStore(subscribeNow, readNow, () => roundNow(serverNow));
}
