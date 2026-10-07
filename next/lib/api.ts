import "server-only";

/**
 * Server-side client for the CampusLink backend.
 *
 * The browser never talks to the backend directly: Server Actions, Route Handlers (the BFF)
 * and the proxy call it through this wrapper, and tokens live in httpOnly cookies.
 */

export const API_URL = (process.env.API_URL || "http://localhost:4000").replace(/\/+$/, "");

const REQUEST_TIMEOUT_MS = 10_000;
const UPLOAD_TIMEOUT_MS = 60_000;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown, options?: ErrorOptions) {
    super(message, options);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type ApiOptions = {
  method?: ApiMethod;
  /** JSON-serialisable body, or a FormData sent as multipart/form-data. */
  body?: unknown;
  /** Access token sent as `Authorization: Bearer <token>`. */
  token?: string;
  /**
   * Headers of the browser's request: its `User-Agent`, and the client address given by a trusted reverse
   * proxy (see clientForwardHeaders), are forwarded so the backend records the real client (audit log,
   * stored sessions, rate limiting). Pass `await headers()` in Server Components/Actions, or
   * `request.headers` in the proxy and Route Handlers.
   */
  forward?: Headers | null;
};

type ErrorBody = { error?: unknown; code?: unknown; details?: unknown };

/**
 * TRUSTED_PROXY_HOPS: how many reverse proxies in front of Next.js append the client address to
 * X-Forwarded-For (0, the default, when Next.js is reached directly). Never more than 10.
 */
function trustedProxyHops(): number {
  const value = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "", 10);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 10) : 0;
}

/** An IPv4/IPv6 literal as written by a proxy (no port, no brackets): anything else is not forwarded. */
const IP_LITERAL = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9A-Fa-f:]*:[0-9A-Fa-f:.]*)$/;

/**
 * The client address to give the backend, or null.
 *
 * X-Forwarded-For is written by whoever sends the request: Next.js keeps a header sent by the browser
 * (it only fills it in when missing), and the backend trusts Next.js (TRUST_PROXY=loopback), so forwarding
 * it as-is would let anyone choose the IP used by the audit log and by the login/OTP/signup/forgot-password
 * rate limits. Only the entries added by our own proxies can be trusted: with N hops, the address seen by the
 * outermost one is the N-th entry from the end. With 0 hops nothing is forwarded (the backend then sees the
 * Next.js host and rate-limits per email).
 */
function trustedClientIp(forwardedFor: string | null): string | null {
  const hops = trustedProxyHops();
  if (hops === 0 || !forwardedFor) return null;
  const entries = forwardedFor.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (entries.length < hops) return null;
  const ip = entries[entries.length - hops];
  return ip.length <= 45 && IP_LITERAL.test(ip) ? ip : null;
}

/** `User-Agent` of the incoming browser request, plus `X-Forwarded-For: <client ip>` when a trusted proxy gave it. */
export function clientForwardHeaders(source?: Headers | null): Record<string, string> {
  if (!source) return {};
  const result: Record<string, string> = {};
  const clientIp = trustedClientIp(source.get("x-forwarded-for"));
  const userAgent = source.get("user-agent");
  if (clientIp) result["X-Forwarded-For"] = clientIp;
  if (userAgent) result["User-Agent"] = userAgent;
  return result;
}

/** Parses a backend error answer into an ApiError (stable `code`, English `error`, optional `details`). */
export async function apiErrorFromResponse(res: Response): Promise<ApiError> {
  const text = await res.text().catch(() => "");
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  const err = (data && typeof data === "object" ? data : {}) as ErrorBody;
  const code = typeof err.code === "string" ? err.code : res.status >= 500 ? "INTERNAL_ERROR" : "UNKNOWN_ERROR";
  const message = typeof err.error === "string" ? err.error : `Request failed with status ${res.status}.`;
  return new ApiError(res.status, code, message, err.details);
}

/**
 * Calls the backend and returns the parsed JSON body (undefined for 204).
 * Throws an ApiError for any non-2xx answer; network failures and timeouts
 * become an ApiError with status 0 and code NETWORK_ERROR.
 */
export async function api<T>(path: string, { method, body, token, forward }: ApiOptions = {}): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const headers: Record<string, string> = { Accept: "application/json", ...clientForwardHeaders(forward) };
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(isForm ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new ApiError(0, "NETWORK_ERROR", "Can't reach the server.", undefined, { cause });
  }

  if (!res.ok) throw await apiErrorFromResponse(res);
  if (res.status === 204) return undefined as T;

  const text = await res.text().catch(() => "");
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined as T;
  }
}

/** Normalises anything thrown by `api()` (or by our own code) into an ApiError. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(500, "INTERNAL_ERROR", "Unexpected error.", undefined, { cause: error });
}
