"use client";

import { useEffect, useLayoutEffect } from "react";
import { adoptOwner } from "@/lib/offline/cleanup";
import { refreshPendingCount, replayOutbox } from "@/lib/offline/outbox";
import { DataOwnerContext, setCurrentOwner } from "@/lib/offline/owner";
import { resyncPushSubscription } from "@/lib/offline/push";
import { invalidateQueries } from "@/lib/offline/query";
import { isOnline, onReconnect } from "@/lib/offline/status";

const PUSH_RESYNC_KEY = "cl-push-resync:";

/** True the first time it is called for `userId` in this tab session (sessionStorage); true when storage is blocked. */
function claimPushResync(userId: string): boolean {
  try {
    const key = `${PUSH_RESYNC_KEY}${userId}`;
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, "1");
  } catch {
    // Storage blocked: re-registering is idempotent, so running it on each mount is harmless.
  }
  return true;
}

/**
 * Wraps the dashboard: scopes the offline data (IndexedDB) to the signed-in user, keeps the
 * pending-sync count up to date and replays the outbox when the connection comes back.
 * Messages from the service worker: OUTBOX_CHANGED (Background Sync replayed items), PUSH_RECEIVED.
 */
export function DataLayerProvider({ userId, children }: Readonly<{ userId: string; children: React.ReactNode }>) {
  // Layout effects run before the children's effects: queries and mutations see the owner.
  useLayoutEffect(() => {
    setCurrentOwner(userId);
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await adoptOwner(userId);
      if (cancelled) return;
      // After adoptOwner, a push subscription left in the browser belongs to this user: attach it to the current
      // session (once per tab session), e.g. one registered under an older session or dropped by the backend.
      if (isOnline() && claimPushResync(userId)) void resyncPushSubscription();
      await refreshPendingCount();
      if (!cancelled && isOnline()) await replayOutbox();
    })();

    const offReconnect = onReconnect(() => {
      void replayOutbox();
    });
    const onMessage = (event: MessageEvent) => {
      const type = (event.data as { type?: unknown } | null)?.type;
      if (type === "OUTBOX_CHANGED") {
        void refreshPendingCount();
        invalidateQueries();
      } else if (type === "PUSH_RECEIVED") {
        invalidateQueries("notifications");
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);

    return () => {
      cancelled = true;
      offReconnect();
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, [userId]);

  return <DataOwnerContext.Provider value={userId}>{children}</DataOwnerContext.Provider>;
}
