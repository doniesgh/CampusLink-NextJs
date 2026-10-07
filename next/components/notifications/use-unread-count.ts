"use client";

import { useOfflineQuery } from "@/lib/offline/query";

/** Query key of the unread notifications counter (update it with useQueryClient().setQueryData). */
export const UNREAD_COUNT_KEY = "notifications:unread-count";

/**
 * Unread notifications count for the nav badge. Starts from the server-rendered value (no request
 * on page load), then refreshes every minute, on reconnect, on tab focus and on push messages.
 */
export function useUnreadCount(initialCount: number, renderedAt?: number): number {
  const { data } = useOfflineQuery<{ count: number }>(UNREAD_COUNT_KEY, "/notifications/unread-count", {
    fallbackData: { count: initialCount },
    fallbackSavedAt: renderedAt,
    revalidateOnMount: false,
    refreshInterval: 60_000,
    reportLastUpdated: false,
  });
  const count = data?.count;
  return typeof count === "number" && count > 0 ? count : 0;
}
