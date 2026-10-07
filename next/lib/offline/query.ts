// useOfflineQuery: stale-while-revalidate reads through the BFF, saved in IndexedDB (store "cache").
// Client Components only. See next/README.md ("Data layer") for usage.
import { useCallback, useEffect, useId, useMemo, useRef, useSyncExternalStore } from "react";
import { BffError, bffFetch } from "@/lib/bff-client";
import { getDb } from "@/lib/offline/db";
import { useDataOwner } from "@/lib/offline/owner";
import { isOnline, onReconnect, reportSavedAt } from "@/lib/offline/status";

export type QueryKey = string | readonly (string | number | boolean | null | undefined)[];

type Entry = {
  data: unknown;
  savedAt: number | null;
  fromCache: boolean;
  error: BffError | null;
  isValidating: boolean;
  /** A first answer (network, storage or error) is known. */
  settled: boolean;
};

type ActiveQuery = { owner: string | null; id: string; path: string; count: number };

const EMPTY: Entry = { data: undefined, savedAt: null, fromCache: false, error: null, isValidating: false, settled: false };
const FOCUS_REVALIDATE_AFTER_MS = 5_000;

const entries = new Map<string, Entry>();
const keyListeners = new Map<string, Set<() => void>>();
const inflight = new Map<string, Promise<void>>();
const loadedFromStorage = new Set<string>();
const active = new Map<string, ActiveQuery>();

/** ["notifications", 2] -> "notifications:2". Invalidate by prefix: invalidateQueries("notifications"). */
export function serializeKey(key: QueryKey): string {
  return typeof key === "string" ? key : key.map((part) => String(part ?? "")).join(":");
}

const memoryKey = (owner: string | null, id: string) => `${owner ?? "anonymous"}::${id}`;
const storageKey = (owner: string, id: string) => `${owner}::${id}`;

function getEntry(key: string): Entry {
  return entries.get(key) ?? EMPTY;
}

function setEntry(key: string, patch: Partial<Entry>): void {
  entries.set(key, { ...getEntry(key), ...patch });
  keyListeners.get(key)?.forEach((listener) => listener());
}

function subscribeKey(key: string, listener: () => void): () => void {
  let set = keyListeners.get(key);
  if (!set) keyListeners.set(key, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) keyListeners.delete(key);
  };
}

async function writeStorage(owner: string, id: string, data: unknown, savedAt: number): Promise<void> {
  try {
    const db = await getDb();
    await db?.put("cache", { key: storageKey(owner, id), owner, data, savedAt });
  } catch {
    // quota or private mode: memory only
  }
}

async function loadFromStorage(key: string, owner: string | null, id: string): Promise<void> {
  if (loadedFromStorage.has(key)) return;
  loadedFromStorage.add(key);
  if (!owner) return;
  try {
    const db = await getDb();
    const record = await db?.get("cache", storageKey(owner, id));
    const current = getEntry(key);
    if (record && (current.savedAt === null || record.savedAt > current.savedAt)) {
      setEntry(key, { data: record.data, savedAt: record.savedAt, fromCache: true, settled: true });
    }
  } catch {
    // unreadable storage: wait for the network
  }
}

function revalidate(key: string, owner: string | null, id: string, path: string): Promise<void> {
  const running = inflight.get(key);
  if (running) return running;
  if (!isOnline()) {
    const current = getEntry(key);
    setEntry(key, {
      settled: true,
      error: current.data === undefined ? new BffError(0, "OFFLINE", "You're offline.") : current.error,
    });
    return Promise.resolve();
  }

  const promise = (async () => {
    setEntry(key, { isValidating: true });
    try {
      const data = await bffFetch(path);
      const savedAt = Date.now();
      setEntry(key, { data, savedAt, fromCache: false, error: null, isValidating: false, settled: true });
      if (owner) await writeStorage(owner, id, data, savedAt);
    } catch (e) {
      const error = e instanceof BffError ? e : new BffError(0, "NETWORK_ERROR", "Can't reach the server.");
      setEntry(key, { error, isValidating: false, settled: true });
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

function applyUpdate<T>(key: string, owner: string | null, id: string, update: T | ((current: T | undefined) => T | undefined)) {
  const current = getEntry(key).data as T | undefined;
  const next = typeof update === "function" ? (update as (current: T | undefined) => T | undefined)(current) : update;
  const savedAt = getEntry(key).savedAt ?? Date.now();
  setEntry(key, { data: next, savedAt, settled: true });
  if (owner && next !== undefined) void writeStorage(owner, id, next, savedAt);
}

/** Revalidates every mounted query whose key equals `prefix` or starts with `prefix:` (all when omitted). */
export function invalidateQueries(prefix?: string): void {
  for (const [key, query] of active) {
    if (!prefix || query.id === prefix || query.id.startsWith(`${prefix}:`)) {
      void revalidate(key, query.owner, query.id, query.path);
    }
  }
}

/** Forgets every in-memory answer (logout). IndexedDB is cleared separately. */
export function resetQueryMemory(): void {
  const keys = [...entries.keys()];
  entries.clear();
  loadedFromStorage.clear();
  for (const key of keys) keyListeners.get(key)?.forEach((listener) => listener());
}

export type OfflineQueryOptions<T> = {
  /**
   * Data rendered by the server (fresh): shown immediately, saved to IndexedDB, and it replaces older
   * in-memory data when the component mounts. Combine with `revalidateOnMount: false` to make no
   * request from the browser on page load.
   */
  fallbackData?: T;
  /**
   * When the server rendered `fallbackData` (ms, e.g. `Date.now()` in the Server Component). A page served
   * from the offline cache carries old data: it then loses against newer data saved in IndexedDB.
   */
  fallbackSavedAt?: number;
  /** Fetch from the network on mount (default true). */
  revalidateOnMount?: boolean;
  /** Fetch again when the tab becomes visible (default true). */
  revalidateOnFocus?: boolean;
  /** Poll every N ms while mounted (default 0 = never). */
  refreshInterval?: number;
  /** Feed the offline banner's "Last updated <time>" (default true). */
  reportLastUpdated?: boolean;
};

export type OfflineQueryResult<T> = {
  data: T | undefined;
  /** When `data` was fetched from the server (ms since epoch), null when unknown. */
  savedAt: number | null;
  /** true while showing data read from IndexedDB that has not been revalidated yet. */
  fromCache: boolean;
  /** No data yet and the first answer is still pending. Show a skeleton. */
  isLoading: boolean;
  isValidating: boolean;
  /** Last failure (BffError: status 0 / code NETWORK_ERROR or OFFLINE when unreachable). Data may still be shown. */
  error: BffError | null;
  /** Fetch again now. */
  refresh: () => Promise<void>;
  /** Local (optimistic) update, also saved to IndexedDB. */
  mutate: (update: T | ((current: T | undefined) => T | undefined)) => void;
};

/**
 * Stale-while-revalidate on top of IndexedDB:
 *   const { data, savedAt, isLoading, error } = useOfflineQuery<Paginated<X>>(["things", page], `/things?page=${page}`);
 * 1. returns saved data immediately (with its `savedAt`),
 * 2. revalidates from /bff/<path> when online (and on reconnect / tab focus / interval),
 * 3. keeps showing saved data when offline. Pass `path = null` to disable the query.
 */
export function useOfflineQuery<T>(key: QueryKey, path: string | null, options: OfflineQueryOptions<T> = {}): OfflineQueryResult<T> {
  const {
    fallbackData,
    fallbackSavedAt,
    revalidateOnMount = true,
    revalidateOnFocus = true,
    refreshInterval = 0,
    reportLastUpdated = true,
  } = options;
  const owner = useDataOwner();
  const id = serializeKey(key);
  const cacheKey = memoryKey(owner, id);
  const instanceId = useId();
  const fallbackRef = useRef({ data: fallbackData, savedAt: fallbackSavedAt });
  const revalidateOnMountRef = useRef(revalidateOnMount);

  const subscribe = useCallback((listener: () => void) => subscribeKey(cacheKey, listener), [cacheKey]);
  const entry = useSyncExternalStore(subscribe, () => getEntry(cacheKey), () => EMPTY);

  // Mount: register, seed with server data, read IndexedDB, then revalidate.
  useEffect(() => {
    if (!path) return;
    const registered = active.get(cacheKey);
    active.set(cacheKey, { owner, id, path, count: (registered?.count ?? 0) + 1 });

    let cancelled = false;
    void (async () => {
      // Server-rendered data replaces older data in memory; newer IndexedDB data (offline copy of an old page) wins.
      const fallback = fallbackRef.current;
      if (fallback.data !== undefined) {
        const savedAt = fallback.savedAt ?? Date.now();
        const current = getEntry(cacheKey);
        if (current.savedAt === null || savedAt > current.savedAt) {
          setEntry(cacheKey, { data: fallback.data, savedAt, fromCache: false, settled: true });
          if (owner) void writeStorage(owner, id, fallback.data, savedAt);
        }
      }
      await loadFromStorage(cacheKey, owner, id);
      if (cancelled) return;
      if (revalidateOnMountRef.current || getEntry(cacheKey).data === undefined) {
        await revalidate(cacheKey, owner, id, path);
      }
    })();

    return () => {
      cancelled = true;
      const current = active.get(cacheKey);
      if (!current || current.count <= 1) active.delete(cacheKey);
      else active.set(cacheKey, { ...current, count: current.count - 1 });
    };
  }, [cacheKey, owner, id, path]);

  // Reconnect, focus and polling.
  useEffect(() => {
    if (!path) return;
    const run = () => void revalidate(cacheKey, owner, id, path);
    const offReconnect = onReconnect(run);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const { savedAt } = getEntry(cacheKey);
      if (savedAt === null || Date.now() - savedAt > FOCUS_REVALIDATE_AFTER_MS) run();
    };
    if (revalidateOnFocus) document.addEventListener("visibilitychange", onVisible);
    const timer = refreshInterval > 0 ? setInterval(run, refreshInterval) : null;
    return () => {
      offReconnect();
      if (revalidateOnFocus) document.removeEventListener("visibilitychange", onVisible);
      if (timer) clearInterval(timer);
    };
  }, [cacheKey, owner, id, path, revalidateOnFocus, refreshInterval]);

  // "Last updated <time>" in the offline banner.
  useEffect(() => {
    if (!reportLastUpdated || !path) return;
    reportSavedAt(instanceId, entry.savedAt);
    return () => reportSavedAt(instanceId, null);
  }, [instanceId, entry.savedAt, reportLastUpdated, path]);

  const refresh = useCallback(() => (path ? revalidate(cacheKey, owner, id, path) : Promise.resolve()), [cacheKey, owner, id, path]);
  const mutate = useCallback(
    (update: T | ((current: T | undefined) => T | undefined)) => applyUpdate<T>(cacheKey, owner, id, update),
    [cacheKey, owner, id]
  );

  const data = (entry.data !== undefined ? entry.data : fallbackData) as T | undefined;
  return {
    data,
    savedAt: entry.savedAt,
    fromCache: entry.fromCache,
    isLoading: data === undefined && !!path && !entry.settled,
    isValidating: entry.isValidating,
    error: entry.error,
    refresh,
    mutate,
  };
}

/** Imperative access to the query cache of the signed-in user (e.g. update a badge after a mutation). */
export function useQueryClient() {
  const owner = useDataOwner();
  return useMemo(
    () => ({
      getQueryData<T>(key: QueryKey): T | undefined {
        return getEntry(memoryKey(owner, serializeKey(key))).data as T | undefined;
      },
      setQueryData<T>(key: QueryKey, update: T | ((current: T | undefined) => T | undefined)): void {
        const id = serializeKey(key);
        applyUpdate<T>(memoryKey(owner, id), owner, id, update);
      },
      invalidate: invalidateQueries,
    }),
    [owner]
  );
}
