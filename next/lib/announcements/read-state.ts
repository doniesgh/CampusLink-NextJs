// "Mark as read" for announcements (Client Components only).
// The read is sent through the offline outbox (queueMutation): it works offline and is replayed on
// reconnection. Until the server confirms it, the UI merges the reads made on this device:
// - reads made during this visit (in memory),
// - reads still waiting in the outbox (IndexedDB), e.g. after an offline reload.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { queueMutation, usePendingCount, useQueryClient, type MutationResult } from "@/lib/offline";
import { getDb } from "@/lib/offline/db";
import { getCurrentOwner, useDataOwner } from "@/lib/offline/owner";
import { detailKey, feedKey, LATEST_KEY, type FeedMode } from "@/lib/announcements/paths";
import type { Announcement, AnnouncementFeed } from "@/lib/announcements/types";

type QueryClient = ReturnType<typeof useQueryClient>;

const READ_PATH_RE = /^\/announcements\/([a-f0-9]{24})\/read$/i;
const EMPTY: ReadonlySet<string> = new Set();
/** Feed pages patched in memory after a read (pages further down are refreshed from the server). */
const PATCHED_FEED_PAGES = 10;

// Reads made during this visit, per signed-in user.
let sessionReads: { owner: string | null; ids: ReadonlySet<string> } = { owner: null, ids: EMPTY };
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function rememberRead(id: string): void {
  const owner = getCurrentOwner();
  const ids = sessionReads.owner === owner ? sessionReads.ids : EMPTY;
  if (ids.has(id)) return;
  sessionReads = { owner, ids: new Set([...ids, id]) };
  listeners.forEach((listener) => listener());
}

/** read is true when the server said so, or when it was read on this device (sent or queued). */
export function isRead(announcement: Pick<Announcement, "id" | "read">, localReads: ReadonlySet<string>): boolean {
  return announcement.read !== false || localReads.has(announcement.id);
}

/** Ids of the announcements read on this device that the cached data may not know about yet. */
export function useLocalReads(): ReadonlySet<string> {
  const owner = useDataOwner();
  const session = useSyncExternalStore(
    subscribe,
    () => sessionReads,
    () => sessionReads
  );
  const pending = usePendingCount();
  const [queued, setQueued] = useState<{ owner: string | null; ids: ReadonlySet<string> }>({ owner: null, ids: EMPTY });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const db = await getDb();
        if (!db || !owner) return;
        const records = await db.getAll("outbox");
        const ids = new Set<string>();
        for (const record of records) {
          const match = record.owner === owner && record.method === "POST" ? READ_PATH_RE.exec(record.path) : null;
          if (match) ids.add(match[1]);
        }
        if (!cancelled) setQueued({ owner, ids });
      } catch {
        // IndexedDB unavailable: only this visit's reads are known.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [owner, pending]);

  return useMemo(() => {
    const fromSession = session.owner === owner ? session.ids : EMPTY;
    const fromOutbox = queued.owner === owner ? queued.ids : EMPTY;
    if (fromOutbox.size === 0) return fromSession;
    if (fromSession.size === 0) return fromOutbox;
    return new Set([...fromSession, ...fromOutbox]);
  }, [session, queued, owner]);
}

function markInFeed(feed: AnnouncementFeed | undefined, id: string): AnnouncementFeed | undefined {
  if (!feed || !Array.isArray(feed.items)) return feed;
  const wasUnread = feed.items.some((item) => item.id === id && item.read === false);
  if (!wasUnread) return feed;
  return {
    ...feed,
    unreadCount: Math.max(0, (feed.unreadCount ?? 0) - 1),
    items: feed.items.map((item) => (item.id === id ? { ...item, read: true } : item)),
  };
}

/** Patches the saved copies (memory + IndexedDB) that already exist. Never creates empty entries. */
function patchCaches(client: QueryClient, id: string): void {
  const detail = client.getQueryData<Announcement>(detailKey(id));
  if (detail && detail.read === false) client.setQueryData<Announcement>(detailKey(id), (current) => current && { ...current, read: true });

  if (client.getQueryData<AnnouncementFeed>(LATEST_KEY)) {
    client.setQueryData<AnnouncementFeed>(LATEST_KEY, (current) => markInFeed(current, id));
  }
  for (const mode of ["all", "unread"] as FeedMode[]) {
    for (let page = 1; page <= PATCHED_FEED_PAGES; page += 1) {
      const key = feedKey(mode, page);
      if (client.getQueryData<AnnouncementFeed>(key)) {
        client.setQueryData<AnnouncementFeed>(key, (current) => markInFeed(current, id));
      }
    }
  }
}

/**
 * Marks an announcement as read: updates the saved lists right away, then sends
 * POST /announcements/:id/read now, or queues it when offline ("1 change waiting to sync").
 */
export async function markAnnouncementRead(id: string, client: QueryClient): Promise<MutationResult> {
  rememberRead(id);
  patchCaches(client, id);
  return queueMutation({ method: "POST", path: `/announcements/${encodeURIComponent(id)}/read` });
}
