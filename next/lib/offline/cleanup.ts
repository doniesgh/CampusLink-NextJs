// Nothing personal stays on the device once a session is over (logout, another account, expired session).
import { DB_NAME, destroyDb, getDb } from "@/lib/offline/db";
import { setCurrentOwner } from "@/lib/offline/owner";
import { resetQueryMemory } from "@/lib/offline/query";
import { setPendingCount } from "@/lib/offline/status";

/** Keep in sync with public/sw.js: "campuslink-pages-<version>" holds the saved pages, each labelled with its owner. */
const PAGES_CACHE_PREFIX = "campuslink-pages";
const OWNER_HEADER = "x-cl-owner";
const PUBLIC_OWNER = "public";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    return (await registration?.pushManager?.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/**
 * Unsubscribes this browser from push. With `server`, first DELETE /bff/push/subscriptions { endpoint }
 * (only possible while the session cookies still exist). Without it, the backend drops the row the next time
 * it pushes to this endpoint (the push service answers 404/410).
 */
async function removePushSubscription({ server }: { server: boolean }): Promise<void> {
  const subscription = await currentPushSubscription();
  if (!subscription) return;
  if (server) {
    await fetch("/bff/push/subscriptions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
      credentials: "same-origin",
    }).catch(() => undefined);
  }
  await subscription.unsubscribe().catch(() => false);
}

async function clearCacheStorage(): Promise<void> {
  if (!("caches" in window)) return;
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
  // The service worker re-downloads its public offline shell (no personal data) for the next visit.
  navigator.serviceWorker?.controller?.postMessage({ type: "PRECACHE" });
}

/**
 * Clears IndexedDB (cache + outbox), Cache Storage and this device's push subscription.
 * `server: false` skips the backend call that unregisters the push subscription (no session anymore).
 * Bounded by `timeoutMs` so logout never hangs; never throws.
 */
export async function clearOfflineData(timeoutMs = 3_000, { server = true }: { server?: boolean } = {}): Promise<void> {
  const work = (async () => {
    await removePushSubscription({ server }).catch(() => undefined);
    await clearCacheStorage().catch(() => undefined);
    await destroyDb();
  })();
  await Promise.race([work, sleep(timeoutMs)]);
  resetQueryMemory();
  setPendingCount(0);
  setCurrentOwner(null);
}

/** True when the "campuslink" database exists; never creates it (unknown → true). */
async function databaseExists(): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  if (typeof indexedDB.databases !== "function") return true;
  try {
    return (await indexedDB.databases()).some((info) => info.name === DB_NAME);
  } catch {
    return true;
  }
}

/** Owner recorded in IndexedDB ("meta" store), or null. Does not create the database. */
async function storedOwner(): Promise<string | null> {
  if (!(await databaseExists())) return null;
  const db = await getDb();
  if (!db) return null;
  try {
    const value = (await db.get("meta", "owner"))?.value;
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
}

/** True when public/sw.js holds a saved page of some account (the public landing page does not count). */
async function hasPrivateSavedPages(): Promise<boolean> {
  if (typeof window === "undefined" || !("caches" in window)) return false;
  try {
    for (const name of (await caches.keys()).filter((key) => key.startsWith(PAGES_CACHE_PREFIX))) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const saved = await cache.match(request, { ignoreVary: true });
        if (saved?.headers.get(OWNER_HEADER) !== PUBLIC_OWNER) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Login and signup pages without a session (components/offline/stale-session-cleanup.tsx): when the
 * previous session ended without "Log out" (browser closed, revoked or expired session, password changed
 * elsewhere), whatever it left goes: IndexedDB, saved pages, push subscription. No backend call (no session).
 * Returns true when something was removed. Never throws.
 */
export async function clearStaleOfflineData(): Promise<boolean> {
  try {
    const [owner, pages, push] = await Promise.all([storedOwner(), hasPrivateSavedPages(), currentPushSubscription()]);
    if (!owner && !pages && !push) return false;
    await clearOfflineData(3_000, { server: false });
    return true;
  } catch {
    return false;
  }
}

/**
 * Called when the dashboard mounts for `owner`: if the device last held another account's data
 * (session ended without logging out), that data, its queued mutations, the other accounts' saved pages and
 * the push subscription go. The push subscription is also dropped when no owner was recorded: it can't be
 * told apart from a previous account's.
 */
export async function adoptOwner(owner: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    const previous = (await db.get("meta", "owner"))?.value;
    if (previous === owner) return;

    const tx = db.transaction(["cache", "outbox", "meta"], "readwrite");
    for (const storeName of ["cache", "outbox"] as const) {
      let cursor = await tx.objectStore(storeName).openCursor();
      while (cursor) {
        if (cursor.value.owner !== owner) await cursor.delete();
        cursor = await cursor.continue();
      }
    }
    await tx.objectStore("meta").put({ key: "owner", value: owner });
    await tx.done;

    // Another account's notifications must not keep reaching this browser.
    await removePushSubscription({ server: false }).catch(() => undefined);
    await dropSavedPagesNotOwnedBy(owner);
  } catch {
    // best effort
  }
}

/** Removes the pages saved by public/sw.js for any other account (each copy carries `x-cl-owner`). */
async function dropSavedPagesNotOwnedBy(owner: string): Promise<void> {
  if (!("caches" in window)) return;
  const names = (await caches.keys()).filter((key) => key.startsWith(PAGES_CACHE_PREFIX));
  for (const name of names) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      const saved = await cache.match(request, { ignoreVary: true });
      const pageOwner = saved?.headers.get(OWNER_HEADER);
      if (pageOwner !== owner && pageOwner !== PUBLIC_OWNER) await cache.delete(request, { ignoreVary: true });
    }
  }
}
