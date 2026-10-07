// Offline helpers of the announcements pages (Client Components only).
// Data lives in IndexedDB (useOfflineQuery); whole pages are saved by the service worker (public/sw.js).
import { useEffect } from "react";
import { invalidateQueries } from "@/lib/offline";
import { detailHref } from "@/lib/announcements/paths";

/** Detail pages saved in the background when the feed is shown online (newest first). */
const SAVED_DETAIL_PAGES = 10;
const SAVE_DELAY_MS = 1_500;
const SAVE_SPACING_MS = 400;

/**
 * Asks the service worker to save the detail pages of these announcements, so they open offline too.
 * The worker skips pages saved less than 10 minutes ago and never refreshes the session for these
 * requests. No-op without an active service worker (development, unsupported browsers).
 */
export function saveDetailPagesForOffline(ids: readonly string[]): () => void {
  if (typeof navigator === "undefined" || !navigator.serviceWorker?.controller) return () => undefined;
  const saved = ids.slice(0, SAVED_DETAIL_PAGES);
  const timers = saved.map((id, index) =>
    setTimeout(() => {
      if (!navigator.onLine) return;
      navigator.serviceWorker?.controller?.postMessage({ type: "CACHE_PAGE", url: detailHref(id) });
    }, SAVE_DELAY_MS + index * SAVE_SPACING_MS)
  );
  // Once a page is saved, make sure the files it needs (scripts, styles, fonts) are saved too.
  timers.push(
    setTimeout(() => void saveAssetsOfSavedPage(saved.map(detailHref)), SAVE_DELAY_MS + saved.length * SAVE_SPACING_MS + ASSETS_DELAY_MS)
  );
  return () => timers.forEach(clearTimeout);
}

const ASSETS_DELAY_MS = 3_000;
const STATIC_ASSET_RE = /\/_next\/static\/[^"'\\\s)<>]+/g;
let assetsSavedFor: string | null = null;

/**
 * A page saved in the background was never displayed, so the scripts of its route may be missing from
 * the service worker's static cache: offline, the page would fail to start. Reads one saved page and
 * requests its missing /_next/static files (the worker stores them, cache-first). Once per build.
 */
async function saveAssetsOfSavedPage(hrefs: string[]): Promise<void> {
  if (typeof caches === "undefined" || !navigator.onLine || !navigator.serviceWorker?.controller) return;
  try {
    for (const href of hrefs) {
      const page = await caches.match(new URL(href, window.location.origin).href, { ignoreVary: true });
      if (!page) continue;
      const html = await page.text();
      const assets = [...new Set(html.match(STATIC_ASSET_RE) ?? [])].map((asset) => asset.replace(/&amp;/g, "&"));
      const signature = assets.join("|");
      if (assetsSavedFor === signature) return;
      for (const asset of assets) {
        if (await caches.match(asset)) continue;
        await fetch(asset, { credentials: "same-origin" }).catch(() => undefined);
      }
      assetsSavedFor = signature;
      return;
    }
  } catch {
    // best effort
  }
}

/** True when the service worker has a saved copy of this page (it can be opened offline). */
export async function isPageSaved(href: string): Promise<boolean> {
  if (typeof window === "undefined" || typeof caches === "undefined") return false;
  try {
    return !!(await caches.match(new URL(href, window.location.origin).href, { ignoreVary: true }));
  } catch {
    return false;
  }
}

/**
 * Full page load (answered by the service worker when offline). A client-side navigation would try
 * to fetch the page's server data first, fail, and log an error before falling back to this.
 */
export function openPageFully(href: string): void {
  window.location.assign(new URL(href, window.location.origin).href);
}

/** Refreshes the announcement lists when a push about an announcement arrives while the app is open. */
export function useAnnouncementPushRefresh(): void {
  useEffect(() => {
    const worker = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
    if (!worker) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; tag?: unknown } | null;
      if (data?.type === "PUSH_RECEIVED" && typeof data.tag === "string" && data.tag.startsWith("announcement-")) {
        invalidateQueries("announcements");
      }
    };
    worker.addEventListener("message", onMessage);
    return () => worker.removeEventListener("message", onMessage);
  }, []);
}
