import "server-only";
import { api } from "@/lib/api";
import type { Session } from "@/lib/types";

/**
 * Single-flight token refresh (proxy + BFF).
 *
 * The backend rotates refresh tokens: a token works once. A page often sends several requests at the
 * same time (navigation, BFF queries, the service worker), and each may find the access token expired.
 * Without coordination they would all call /api/auth/refresh with the same refresh token, all but one
 * would get 401, and their responses would clear the cookies: the user would be signed out.
 *
 * So concurrent refreshes with the same refresh token share one backend call, and the resulting session
 * is reused for GRACE_MS by requests that still carry the old token (their browser had not received the
 * new cookies yet). Memory only, per server process (kept on globalThis so the proxy and the route
 * handlers share it when they run in the same process).
 */

const GRACE_MS = 30_000;

type Entry = { promise: Promise<Session>; settledAt?: number };

const globalStore = globalThis as typeof globalThis & { __campuslinkRefresh?: Map<string, Entry> };
const inflight: Map<string, Entry> = (globalStore.__campuslinkRefresh ??= new Map());

export function refreshSessionOnce(refreshToken: string, forward?: Headers | null): Promise<Session> {
  const now = Date.now();
  for (const [token, entry] of inflight) {
    if (entry.settledAt !== undefined && now - entry.settledAt > GRACE_MS) inflight.delete(token);
  }

  const existing = inflight.get(refreshToken);
  if (existing) return existing.promise;

  const entry: Entry = { promise: api<Session>("/api/auth/refresh", { body: { refreshToken }, forward }) };
  inflight.set(refreshToken, entry);
  entry.promise.then(
    () => {
      entry.settledAt = Date.now();
    },
    () => {
      inflight.delete(refreshToken);
    }
  );
  return entry.promise;
}
