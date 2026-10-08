"use client";

// React hooks of the real-time layer (Client Components). The connection is opened by the first component
// that uses one of them and closed a few seconds after the last one unmounts (lib/realtime/client.ts).
import { useEffect, useEffectEvent, useSyncExternalStore } from "react";
import { useDataOwner } from "@/lib/offline/owner";
import {
  getRoomSnapshot,
  getStatus,
  rejoinRoom,
  retain,
  retainRoom,
  subscribeEvent,
  subscribeStore,
  type ConnectionStatus,
  type RoomSnapshot,
} from "@/lib/realtime/client";

const NO_ROOM: RoomSnapshot = { status: "joining", error: null, joins: 0 };

/**
 * Calls `handler` with the payload of every `event` the server sends to this user (`notification:new`,
 * `carpool:request`…) or to a room joined with useRealtimeRoom (`chat:message`, `trip:updated`). The latest
 * `handler` is always used (no need to memoise it). `enabled: false` neither listens nor connects.
 *
 *   useRealtimeEvent<TripMessage>("chat:message", (message) => { if (message.tripId === id) add(message); });
 */
export function useRealtimeEvent<T = unknown>(event: string, handler: (payload: T) => void, { enabled = true }: { enabled?: boolean } = {}): void {
  const owner = useDataOwner();
  const onEvent = useEffectEvent((payload: unknown) => handler(payload as T));
  useEffect(() => {
    if (!enabled) return;
    const release = retain(owner);
    const unsubscribe = subscribeEvent(event, (payload) => onEvent(payload));
    return () => {
      unsubscribe();
      release();
    };
  }, [event, enabled, owner]);
}

/**
 * Stays in `room` (e.g. "trip:<id>") while mounted with a non-null room: joined now and again after every
 * reconnection. Returns its state: `status` "joining" | "joined" | "error" (`error`: FORBIDDEN, UNKNOWN_ROOM,
 * TOO_MANY_ROOMS…), and `joins`, which grows on every successful join: data that may have been missed while
 * disconnected should be fetched again when it changes.
 */
export function useRealtimeRoom(room: string | null): RoomSnapshot & { retry: () => void } {
  const owner = useDataOwner();
  useEffect(() => {
    if (!room) return;
    const release = retain(owner);
    const leave = retainRoom(room);
    return () => {
      leave();
      release();
    };
  }, [room, owner]);
  const snapshot = useSyncExternalStore(
    subscribeStore,
    () => (room ? getRoomSnapshot(room) : null),
    () => null
  );
  return { ...(snapshot ?? NO_ROOM), retry: () => room && rejoinRoom(room) };
}

/** Connection state, for a "Live" / "Reconnecting…" indicator ("idle" on the server and when unused). */
export function useRealtimeStatus(): ConnectionStatus {
  return useSyncExternalStore(subscribeStore, getStatus, () => "idle");
}
