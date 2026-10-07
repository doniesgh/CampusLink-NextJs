import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { API_URL, clientForwardHeaders, toApiError } from "@/lib/api";
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
 * - Non-GET/HEAD requests need an `Origin` header matching this site (else 403 FORBIDDEN).
 * - Bodies (JSON, multipart uploads, anything) and responses (JSON, files, .ics) are passed through;
 *   the browser's User-Agent is forwarded, and its address only when a trusted proxy gave it
 *   (TRUSTED_PROXY_HOPS, see clientForwardHeaders in lib/api.ts).
 */

const UPSTREAM_TIMEOUT_MS = 60_000;
const REQUEST_HEADERS = ["content-type", "accept", "accept-language"];
const RESPONSE_HEADERS = ["content-type", "content-disposition", "etag", "last-modified"];
const NO_BODY_STATUSES = new Set([101, 204, 205, 304]);

function jsonError(status: number, code: string, error: string): NextResponse {
  return NextResponse.json({ error, code }, { status, headers: { "Cache-Control": "private, no-store" } });
}

/** Same check as Server Actions: the Origin's host must be this site's host. */
function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host");
  return !!host && originHost.toLowerCase() === host.toLowerCase();
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
  if (hasBody && !isSameOrigin(request)) {
    return jsonError(403, "FORBIDDEN", "Cross-origin request blocked");
  }

  const upstreamUrl = `${API_URL}/api/${segments.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;
  // Buffered so the request can be replayed after a token refresh (uploads are capped by the backend).
  const body = hasBody ? await request.arrayBuffer() : undefined;

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
