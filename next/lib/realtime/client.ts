// Real-time layer of the web app (phase 3 contract section 1): ONE Socket.IO connection per tab, shared by
// every component through lib/realtime/hooks.ts. Browser-only code (called from effects); importing it on the
// server is harmless.
//
// - Connects to NEXT_PUBLIC_REALTIME_URL (inlined at build time; the page CSP allows the same origin),
//   path /socket.io, WebSocket transport only.
// - The browser has no access token (httpOnly cookies): every handshake gets a fresh single-use ticket from
//   GET /bff/realtime/ticket (`auth` is a callback, so reconnections never reuse a ticket).
// - Connected only while a component needs it (reference count, closed 5 s after the last one leaves, so a
//   client-side navigation between two carpool pages keeps the connection).
// - Rooms (`trip:<id>`) are joined again after every reconnection: the server does not restore them.
// - Silent offline: when the browser goes offline the socket is closed (no reconnection attempts, so no failed
//   WebSocket in the console) and it reconnects when the connection comes back (lib/offline/status.ts).
// - A refused handshake (ticket expired, reused, user deleted) is retried with a fresh ticket and a growing
//   delay; a 401 from the ticket endpoint means the session is over: it stops ("unavailable").
import { io, type Socket } from "socket.io-client";
import { isOnline, onReconnect } from "@/lib/offline/status";

export type ConnectionStatus =
  /** Nobody needs the connection. */
  | "idle"
  /** First connection in progress. */
  | "connecting"
  | "connected"
  /** Lost: trying again. */
  | "reconnecting"
  /** The browser is offline: waiting for the network, silently. */
  | "offline"
  /** The session is over (the ticket endpoint answered 401): nothing more is attempted. */
  | "unavailable";

export type RoomStatus = "joining" | "joined" | "error";

/** State of a room for the components that use it. `joins` counts the successful joins (one per connection). */
export type RoomSnapshot = { status: RoomStatus; error: string | null; joins: number };

type Handler = (payload: unknown) => void;
type RoomEntry = { count: number; snapshot: RoomSnapshot };
type JoinAck = { ok?: boolean; error?: unknown };

const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL || "http://localhost:4000";
const TICKET_URL = "/bff/realtime/ticket";
const IDLE_DISCONNECT_MS = 5_000;
const RETRY_DELAYS_MS = [1_000, 3_000, 10_000, 30_000] as const;
const JOIN_TIMEOUT_MS = 10_000;
const JOIN_RETRY_MS = 3_000;
/** Join failures worth another try on the same connection (the others wait for the next connection). */
const RETRYABLE_JOIN_ERRORS = new Set(["TOO_MANY_REQUESTS", "INTERNAL_ERROR", "TIMEOUT"]);

let socket: Socket | null = null;
let socketOwner: string | null | undefined;
let status: ConnectionStatus = "idle";
let users = 0;
let connections = 0;
let retryIndex = 0;
let sessionEnded = false;
let lifecycleBound = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const handlers = new Map<string, Set<Handler>>();
const rooms = new Map<string, RoomEntry>();
const listeners = new Set<() => void>();

// ---------- Store (read by useSyncExternalStore)

function notify(): void {
  for (const listener of listeners) listener();
}

function setStatus(next: ConnectionStatus): void {
  if (status === next) return;
  status = next;
  notify();
}

function patchRoom(room: string, patch: Partial<RoomSnapshot>): void {
  const entry = rooms.get(room);
  if (!entry) return;
  entry.snapshot = { ...entry.snapshot, ...patch };
  notify();
}

/** Every room needs a new join after a disconnection. */
function resetRooms(): void {
  let changed = false;
  for (const entry of rooms.values()) {
    if (entry.snapshot.status !== "joining" || entry.snapshot.error !== null) {
      entry.snapshot = { ...entry.snapshot, status: "joining", error: null };
      changed = true;
    }
  }
  if (changed) notify();
}

export function subscribeStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getStatus(): ConnectionStatus {
  return status;
}

export function getRoomSnapshot(room: string): RoomSnapshot | null {
  return rooms.get(room)?.snapshot ?? null;
}

// ---------- Connection

function clearRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

function clearIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

/** A single-use ticket for the next handshake, or null (401 also ends the session for this layer). */
async function fetchTicket(): Promise<string | null> {
  if (!isOnline()) return null;
  try {
    const res = await fetch(TICKET_URL, { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" } });
    if (res.status === 401) {
      sessionEnded = true;
      return null;
    }
    if (!res.ok) return null;
    const data = (await res.json()) as { ticket?: unknown };
    return typeof data?.ticket === "string" && data.ticket ? data.ticket : null;
  } catch {
    return null;
  }
}

/** Closes the socket on purpose (no automatic reconnection) and records why. */
function shutdown(next: ConnectionStatus): void {
  clearRetry();
  if (socket && (socket.connected || socket.active)) socket.disconnect();
  resetRooms();
  setStatus(next);
}

function scheduleRetry(): void {
  clearRetry();
  if (users === 0 || sessionEnded) return;
  const delay = RETRY_DELAYS_MS[Math.min(retryIndex, RETRY_DELAYS_MS.length - 1)];
  retryIndex += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, delay);
}

/** The handshake could not happen (no ticket) or was refused: wait, then try again with a new ticket. */
function retryLater(): void {
  if (sessionEnded) {
    shutdown("unavailable");
    return;
  }
  if (!isOnline()) {
    shutdown("offline");
    return;
  }
  if (socket && (socket.connected || socket.active)) socket.disconnect();
  setStatus(connections > 0 ? "reconnecting" : "connecting");
  scheduleRetry();
}

function dispatch(event: string, ...args: unknown[]): void {
  const set = handlers.get(event);
  if (!set) return;
  for (const handler of [...set]) {
    try {
      handler(args[0]);
    } catch (error) {
      // A failing component must not break the others (nor Socket.IO's emitter).
      globalThis.reportError?.(error);
    }
  }
}

function joinRoom(room: string): void {
  const current = socket;
  if (!current?.connected || !rooms.has(room)) return;
  patchRoom(room, { status: "joining", error: null });
  current.timeout(JOIN_TIMEOUT_MS).emit("room:join", { room }, (error: Error | null, ack?: JoinAck) => {
    if (current !== socket || !current.connected || !rooms.has(room)) return;
    if (!error && ack?.ok) {
      const entry = rooms.get(room);
      patchRoom(room, { status: "joined", error: null, joins: (entry?.snapshot.joins ?? 0) + 1 });
      return;
    }
    const code = error ? "TIMEOUT" : typeof ack?.error === "string" ? ack.error : "INTERNAL_ERROR";
    patchRoom(room, { status: "error", error: code });
    if (RETRYABLE_JOIN_ERRORS.has(code)) {
      setTimeout(() => {
        if (current === socket && current.connected && rooms.get(room)?.snapshot.status === "error") joinRoom(room);
      }, JOIN_RETRY_MS);
    }
  });
}

function createSocket(): Socket {
  const created = io(REALTIME_URL, {
    path: "/socket.io",
    transports: ["websocket"],
    autoConnect: false,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 30_000,
    // Called for every handshake (first connection and reconnections): a fresh single-use ticket each time.
    auth: (send) => {
      void fetchTicket().then((ticket) => {
        if (created !== socket) return;
        if (ticket) send({ ticket });
        else retryLater();
      });
    },
  });

  created.on("connect", () => {
    if (created !== socket) return;
    clearRetry();
    retryIndex = 0;
    connections += 1;
    setStatus("connected");
    for (const room of rooms.keys()) joinRoom(room);
  });

  created.on("disconnect", (reason) => {
    if (created !== socket) return;
    resetRooms();
    if (reason === "io client disconnect") return; // shutdown() / retryLater() set the status
    if (!isOnline()) {
      shutdown("offline");
      return;
    }
    setStatus("reconnecting");
    // "io server disconnect": the server closed it, Socket.IO does not reconnect by itself.
    if (!created.active) scheduleRetry();
  });

  created.on("connect_error", () => {
    if (created !== socket) return;
    if (!isOnline()) {
      shutdown("offline");
      return;
    }
    // Transport failure (server unreachable): the Socket.IO manager retries by itself with a growing delay.
    if (created.active) {
      setStatus(connections > 0 ? "reconnecting" : "connecting");
      return;
    }
    // Refused by the server (connect_error data.code AUTH_REQUIRED / INVALID_TOKEN / TOKEN_EXPIRED /
    // TOO_MANY_CONNECTIONS): no automatic retry for those, so try again with a new ticket.
    retryLater();
  });

  created.onAny(dispatch);
  return created;
}

function bindLifecycle(): void {
  if (lifecycleBound || typeof window === "undefined") return;
  lifecycleBound = true;
  window.addEventListener("offline", () => {
    if (users > 0) shutdown("offline");
  });
  // Browser back online, or the BFF reachable again after failures (lib/offline/status.ts).
  onReconnect(() => {
    if (users === 0) return;
    retryIndex = 0;
    connect();
  });
}

function connect(): void {
  if (typeof window === "undefined" || users === 0) return;
  bindLifecycle();
  if (sessionEnded) {
    setStatus("unavailable");
    return;
  }
  if (!isOnline()) {
    shutdown("offline");
    return;
  }
  if (!socket) socket = createSocket();
  if (socket.connected || socket.active) return; // connected, or a (re)connection is in progress
  clearRetry();
  setStatus(connections > 0 ? "reconnecting" : "connecting");
  socket.connect();
}

/** Drops the socket of another account (handlers and rooms stay: they belong to the components). */
function resetSocket(): void {
  clearRetry();
  if (socket) {
    const previous = socket;
    socket = null;
    previous.removeAllListeners();
    previous.offAny();
    previous.disconnect();
  }
  connections = 0;
  retryIndex = 0;
  resetRooms();
  setStatus("idle");
}

// ---------- API used by the hooks

/**
 * A component needs the connection (for `owner`, the signed-in user id). Returns the release function.
 * The connection opens now and closes a few seconds after the last release.
 */
export function retain(owner: string | null): () => void {
  if (typeof window === "undefined") return () => {};
  if (socketOwner !== undefined && owner !== socketOwner) resetSocket();
  socketOwner = owner;
  if (users === 0) sessionEnded = false;
  users += 1;
  clearIdle();
  connect();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    users -= 1;
    if (users > 0) return;
    clearIdle();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (users === 0) shutdown("idle");
    }, IDLE_DISCONNECT_MS);
  };
}

/** Calls `handler` for every `event` received. Returns the unsubscribe function. */
export function subscribeEvent(event: string, handler: Handler): () => void {
  let set = handlers.get(event);
  if (!set) handlers.set(event, (set = new Set()));
  set.add(handler);
  return () => {
    set.delete(handler);
    if (set.size === 0 && handlers.get(event) === set) handlers.delete(event);
  };
}

/** Joins `room` (now, and again after every reconnection) until the returned function is called. */
export function retainRoom(room: string): () => void {
  let entry = rooms.get(room);
  if (!entry) {
    entry = { count: 0, snapshot: { status: "joining", error: null, joins: 0 } };
    rooms.set(room, entry);
    notify();
  }
  entry.count += 1;
  if (entry.count === 1) joinRoom(room);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = rooms.get(room);
    if (!current) return;
    current.count -= 1;
    if (current.count > 0) return;
    rooms.delete(room);
    notify();
    if (socket?.connected) socket.emit("room:leave", { room });
  };
}

/** Tries to join `room` again now (e.g. after a FORBIDDEN answer, once the user became a participant). */
export function rejoinRoom(room: string): void {
  if (rooms.has(room)) joinRoom(room);
}
