import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { API_URL, clientForwardHeaders, toApiError, trustedProxyHops } from "@/lib/api";
import { isTokenFresh } from "@/lib/jwt";
import { refreshSessionOnce } from "@/lib/refresh";
import {
  ACCESS_COOKIE,
  clearSessionCookies,
  REFRESH_COOKIE,
  REMEMBER_COOKIE,
  setSessionCookies,
} from "@/lib/session";
import type { Session } from "@/lib/types";

/**
 * Backend-for-frontend relay: /bff/<path>?<query> -> API_URL/api/<path>?<query>.
 *
 * - Adds `Authorization: Bearer <cl_access>`; refreshes the pair first when the access token is
 *   missing/expiring, and once more when the backend answers 401 TOKEN_EXPIRED (new cookies are set
 *   on the response). A 401 that can't be fixed is returned as-is (the client goes to /login).
 * - /bff/auth/* -> 404: authentication only goes through Server Actions.
 * - Non-GET/HEAD requests, checked in this order before any byte of the body is read:
 *   1. the `Origin` header must be this site (else 403 FORBIDDEN): one of APP_ORIGIN when set, otherwise
 *      the `Host` header (`X-Forwarded-Host` only behind trusted proxies, TRUSTED_PROXY_HOPS > 0);
 *   2. a session cookie must be present (else 401 AUTH_REQUIRED, the backend's code for "not signed in");
 *   3. the body must be at most MAX_BODY_BYTES = 5 x MAX_UPLOAD_MB + 1 MB (else 413 PAYLOAD_TOO_LARGE):
 *      `Content-Length` is checked first, and the limit is enforced while reading (chunked bodies).
 * - Bodies (JSON, multipart uploads, anything) and responses (JSON, files, .ics) are passed through;
 *   the browser's User-Agent is forwarded, and its address only when a trusted proxy gave it
 *   (TRUSTED_PROXY_HOPS, see clientForwardHeaders in lib/api.ts).
 */

const UPSTREAM_TIMEOUT_MS = 60_000;
const MB = 1024 * 1024;
/** The backend's MAX_UPLOAD_MB (default 10): an announcement carries up to 5 such files. */
const MAX_UPLOAD_MB = positiveInt(process.env.MAX_UPLOAD_MB) ?? 10;
/** Largest relayed request body: 5 files + 1 MB for the other fields and the multipart framing. */
export const MAX_BODY_BYTES = (5 * MAX_UPLOAD_MB + 1) * MB;
const REQUEST_HEADERS = ["content-type", "accept", "accept-language"];
const RESPONSE_HEADERS = ["content-type", "content-disposition", "etag", "last-modified"];
const NO_BODY_STATUSES = new Set([101, 204, 205, 304]);

function positiveInt(value: string | undefined): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function jsonError(status: number, code: string, error: string): NextResponse {
  return NextResponse.json({ error, code }, { status, headers: { "Cache-Control": "private, no-store" } });
}

function tooLarge(): NextResponse {
  return jsonError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
}

/** "https://Example.com:443/x" -> "https://example.com" (http/https only), else null. */
function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** APP_ORIGIN: the public origin(s) of the web app, comma-separated (e.g. "https://campuslink.example"). */
const APP_ORIGINS = (process.env.APP_ORIGIN ?? "")
  .split(",")
  .map((value) => originOf(value.trim()))
  .filter((value): value is string => value !== null);

/**
 * The host the browser sent this request to. `X-Forwarded-Host` is written by whoever sends the request
 * (Next.js keeps one sent by a client), so it is only read behind our own proxies: with N hops, the entry
 * written by the outermost one (the N-th from the end), like X-Forwarded-For in lib/api.ts.
 */
function requestHost(request: NextRequest): string | null {
  const hops = trustedProxyHops();
  if (hops > 0) {
    const entries = (request.headers.get("x-forwarded-host") ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (entries.length >= hops) return entries[entries.length - hops];
  }
  return request.headers.get("host");
}

/** The Origin header must name this site: one of APP_ORIGIN when set, else the request's host. */
function isSameOrigin(request: NextRequest): boolean {
  const header = request.headers.get("origin");
  const origin = header && header !== "null" ? originOf(header) : null;
  if (!origin) return false;
  if (APP_ORIGINS.length > 0) return APP_ORIGINS.includes(origin);
  const host = requestHost(request);
  return !!host && new URL(origin).host === host.toLowerCase();
}

function hasSessionCookie(request: NextRequest): boolean {
  return !!(request.cookies.get(ACCESS_COOKIE)?.value || request.cookies.get(REFRESH_COOKIE)?.value);
}

/** Reads the whole body, or returns null as soon as it grows over `limit` bytes (the rest is never read). */
async function readBody(request: NextRequest, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function errorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.clone().json()) as { code?: unknown };
    return typeof body.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

export async function handleBff(request: NextRequest, segments: string[]): Promise<Response> {
  if (
    segments.length === 0 ||
    segments[0].toLowerCase() === "auth" ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return jsonError(404, "NOT_FOUND", "Route not found");
  }

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  let body: Uint8Array<ArrayBuffer> | undefined;
  if (hasBody) {
    if (!isSameOrigin(request)) return jsonError(403, "FORBIDDEN", "Cross-origin request blocked");
    if (!hasSessionCookie(request)) return jsonError(401, "AUTH_REQUIRED", "Authentication required");
    const declared = Number(request.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return tooLarge();
    // Buffered so the request can be replayed after a token refresh; the size limit is enforced while reading.
    const read = await readBody(request, MAX_BODY_BYTES);
    if (read === null) return tooLarge();
    body = read;
  }

  const upstreamUrl = `${API_URL}/api/${segments.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;

  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  let accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  let refreshed: Session | null = null;
  let refreshRejected = false;

  const refresh = async (): Promise<boolean> => {
    if (!refreshToken || refreshed) return false;
    try {
      refreshed = await refreshSessionOnce(refreshToken, request.headers);
      accessToken = refreshed.accessToken;
      return true;
    } catch (e) {
      const error = toApiError(e);
      refreshRejected = error.status === 400 || error.status === 401;
      return false;
    }
  };

  const callUpstream = async (): Promise<Response> => {
    const headers: Record<string, string> = { ...clientForwardHeaders(request.headers) };
    for (const name of REQUEST_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers[name] = value;
    }
    if (!headers.accept) headers.accept = "application/json";
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    return fetch(upstreamUrl, {
      method,
      headers,
      body: body && body.byteLength > 0 ? body : undefined,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  };

  if ((!accessToken || !isTokenFresh(accessToken)) && refreshToken) {
    await refresh();
  }

  let upstream: Response;
  try {
    upstream = await callUpstream();
    if (upstream.status === 401 && (await errorCode(upstream)) === "TOKEN_EXPIRED" && (await refresh())) {
      upstream = await callUpstream();
    }
  } catch {
    return jsonError(502, "NETWORK_ERROR", "Can't reach the server.");
  }

  const headers = new Headers({ "Cache-Control": "private, no-store" });
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // fetch() decompresses bodies: only keep the length when the upstream body was not encoded.
  const length = upstream.headers.get("content-length");
  if (length && !upstream.headers.get("content-encoding")) headers.set("content-length", length);

  const passBody = method !== "HEAD" && !NO_BODY_STATUSES.has(upstream.status);
  const response = new NextResponse(passBody ? upstream.body : null, { status: upstream.status, headers });

  if (refreshed) {
    const remember = request.cookies.get(REMEMBER_COOKIE)?.value === "1";
    setSessionCookies(response.cookies, refreshed, remember);
  } else if (refreshRejected) {
    clearSessionCookies(response.cookies);
  }
  return response;
}
