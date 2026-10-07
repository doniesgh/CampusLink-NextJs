// Connectivity + sync status shared by the whole client app (banner, data layer, pages).
// A tiny external store read with useSyncExternalStore: SSR and hydration always see "online".
import { useSyncExternalStore } from "react";

type Status = {
  /** false when the browser says so, or after a request could not reach the server. */
  online: boolean;
  /** Mutations waiting in the IndexedDB outbox for the current user. */
  pending: number;
  /** Oldest `savedAt` (ms) among the data currently displayed from useOfflineQuery, or null. */
  lastUpdated: number | null;
};

const SERVER_STATUS: Status = { online: true, pending: 0, lastUpdated: null };
const PROBE_INTERVAL_MS = 5_000;

let status: Status = SERVER_STATUS;
const listeners = new Set<() => void>();
const reconnectListeners = new Set<() => void>();
const savedAtById = new Map<string, number>();
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let initialised = false;

function emit(): void {
  for (const listener of listeners) listener();
}

function setStatus(patch: Partial<Status>): void {
  const nextStatus = { ...status, ...patch };
  if (
    nextStatus.online === status.online &&
    nextStatus.pending === status.pending &&
    nextStatus.lastUpdated === status.lastUpdated
  ) {
    return;
  }
  const cameBack = !status.online && nextStatus.online;
  status = nextStatus;
  emit();
  if (cameBack) for (const listener of reconnectListeners) listener();
}

function init(): void {
  if (initialised || typeof window === "undefined") return;
  initialised = true;
  status = { ...status, online: navigator.onLine };
  window.addEventListener("online", () => {
    stopProbe();
    setStatus({ online: true });
  });
  window.addEventListener("offline", () => setStatus({ online: false }));
}

function stopProbe(): void {
  if (probeTimer) clearTimeout(probeTimer);
  probeTimer = null;
}

/** While offline-by-failure (navigator.onLine still true), checks /bff/health until it answers. */
function scheduleProbe(): void {
  if (probeTimer || typeof window === "undefined") return;
  probeTimer = setTimeout(async () => {
    probeTimer = null;
    if (status.online) return;
    try {
      const res = await fetch("/bff/health", { cache: "no-store", credentials: "same-origin" });
      if (res.ok) {
        setStatus({ online: true });
        return;
      }
    } catch {
      // still offline
    }
    if (!status.online && navigator.onLine) scheduleProbe();
  }, PROBE_INTERVAL_MS);
}

function subscribe(listener: () => void): () => void {
  init();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Status {
  init();
  return status;
}

function getServerSnapshot(): Status {
  return SERVER_STATUS;
}

/** A request could not reach the server: show the offline state and start probing. */
export function reportNetworkFailure(): void {
  init();
  setStatus({ online: false });
  if (navigator.onLine) scheduleProbe();
}

/** A request reached the server. */
export function reportNetworkSuccess(): void {
  init();
  if (!status.online && navigator.onLine) {
    stopProbe();
    setStatus({ online: true });
  }
}

export function isOnline(): boolean {
  init();
  return status.online;
}

export function setPendingCount(pending: number): void {
  setStatus({ pending });
}

/** Called when connectivity comes back (browser event or successful probe). */
export function onReconnect(listener: () => void): () => void {
  init();
  reconnectListeners.add(listener);
  return () => reconnectListeners.delete(listener);
}

/** Data pages report when their displayed data was saved ("Last updated <time>" in the banner). */
export function reportSavedAt(id: string, savedAt: number | null): void {
  if (savedAt === null) savedAtById.delete(id);
  else savedAtById.set(id, savedAt);
  const values = [...savedAtById.values()];
  setStatus({ lastUpdated: values.length > 0 ? Math.min(...values) : null });
}

export function useConnectivity(): Status {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** true while online (false during SSR never happens: the server snapshot is "online"). */
export function useOnlineStatus(): boolean {
  return useConnectivity().online;
}

export function usePendingCount(): number {
  return useConnectivity().pending;
}
