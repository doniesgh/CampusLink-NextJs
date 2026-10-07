// queueMutation: writes that survive being offline (IndexedDB store "outbox").
// Phase 1 only queues idempotent operations (e.g. "mark as read"); last write wins per method + path.
import { BffError, bffFetch, type BffMethod } from "@/lib/bff-client";
import { getDb, type OutboxRecord } from "@/lib/offline/db";
import { getCurrentOwner } from "@/lib/offline/owner";
import { invalidateQueries } from "@/lib/offline/query";
import { isOnline, reportNetworkFailure, setPendingCount } from "@/lib/offline/status";

export const SYNC_TAG = "campuslink-outbox";
const LOCK_NAME = "campuslink-outbox";

/** Fired on window after queued mutations were sent: `detail = { sent: number }`. */
export const OUTBOX_REPLAYED_EVENT = "campuslink:outbox-replayed";

export type MutationRequest = {
  method: Exclude<BffMethod, "GET">;
  /** API path relative to /bff, e.g. "/notifications/123/read". */
  path: string;
  /** JSON body (no FormData: it can't be stored). */
  body?: unknown;
};

export type MutationResult<T = unknown> =
  | { status: "sent"; data: T }
  | { status: "queued" }
  | { status: "failed"; error: BffError };

type NavigatorWithLocks = Navigator & {
  locks?: { request<R>(name: string, callback: () => Promise<R>): Promise<R> };
};

async function withLock<R>(callback: () => Promise<R>): Promise<R> {
  const locks = typeof navigator !== "undefined" ? (navigator as NavigatorWithLocks).locks : undefined;
  return locks ? locks.request(LOCK_NAME, callback) : callback();
}

/** Recounts the current user's waiting mutations (feeds the "<n> changes waiting to sync" banner). */
export async function refreshPendingCount(): Promise<number> {
  const owner = getCurrentOwner();
  try {
    const db = await getDb();
    if (!db || !owner) {
      setPendingCount(0);
      return 0;
    }
    const all = await db.getAll("outbox");
    const count = all.filter((record) => record.owner === owner).length;
    setPendingCount(count);
    return count;
  } catch {
    return 0;
  }
}

/** Asks the service worker to replay the outbox when the connection comes back (Background Sync). */
async function requestBackgroundSync(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    const sync = (registration as (ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }) | undefined)
      ?.sync;
    await sync?.register(SYNC_TAG);
  } catch {
    // Not supported (Firefox, Safari): the page replays on the "online" event instead.
  }
}

async function enqueue(request: MutationRequest): Promise<boolean> {
  const owner = getCurrentOwner();
  const db = await getDb();
  if (!db || !owner) return false;
  const record: OutboxRecord = {
    id: `${owner}|${request.method} ${request.path}`,
    owner,
    method: request.method,
    path: request.path,
    body: request.body,
    createdAt: Date.now(),
  };
  try {
    await db.put("outbox", record);
  } catch {
    return false;
  }
  await refreshPendingCount();
  void requestBackgroundSync();
  return true;
}

/**
 * Runs the mutation now when online; when offline (or when the request can't reach the server)
 * stores it in the outbox and replays it on reconnection / through Background Sync.
 *
 *   const result = await queueMutation({ method: "POST", path: `/notifications/${id}/read` });
 *   if (result.status === "failed") show(result.error) // a real API error (4xx/5xx), not queued
 */
export async function queueMutation<T = unknown>(request: MutationRequest): Promise<MutationResult<T>> {
  if (isOnline()) {
    try {
      const data = await bffFetch<T>(request.path, { method: request.method, body: request.body });
      return { status: "sent", data };
    } catch (e) {
      const error = e instanceof BffError ? e : new BffError(0, "NETWORK_ERROR", "Can't reach the server.");
      if (!error.isNetworkError) return { status: "failed", error };
      // Unreachable: fall through and keep it for later.
    }
  }
  if (await enqueue(request)) return { status: "queued" };
  return { status: "failed", error: new BffError(0, "OFFLINE", "You're offline.") };
}

/**
 * Sends the current user's waiting mutations, oldest first. Stops at the first network failure
 * (or 401: the session is over, items stay for the next login of the same user); drops items the
 * API rejects for good (4xx). Safe to call often: runs under a Web Lock shared with the service worker.
 */
export async function replayOutbox(): Promise<{ sent: number; remaining: number }> {
  const owner = getCurrentOwner();
  if (!owner) return { sent: 0, remaining: 0 };

  const result = await withLock(async () => {
    const db = await getDb();
    if (!db) return { sent: 0 };
    const records = (await db.getAllFromIndex("outbox", "createdAt")).filter((record) => record.owner === owner);
    let sent = 0;
    for (const record of records) {
      try {
        await bffFetch(record.path, { method: record.method, body: record.body, redirectOnUnauthorized: false });
        await db.delete("outbox", record.id);
        sent += 1;
      } catch (e) {
        const error = e instanceof BffError ? e : new BffError(0, "NETWORK_ERROR", "Can't reach the server.");
        if (error.isNetworkError) {
          if (error.status === 0) reportNetworkFailure();
          break;
        }
        if (error.status === 401) break;
        await db.delete("outbox", record.id);
      }
    }
    return { sent };
  });

  const remaining = await refreshPendingCount();
  if (result.sent > 0) {
    invalidateQueries();
    window.dispatchEvent(new CustomEvent(OUTBOX_REPLAYED_EVENT, { detail: { sent: result.sent } }));
  }
  return { sent: result.sent, remaining };
}
