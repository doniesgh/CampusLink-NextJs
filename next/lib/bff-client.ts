// Browser-side calls to the BFF (/bff/<path> -> backend /api/<path>). Client Components only.
import { reportNetworkFailure, reportNetworkSuccess } from "@/lib/offline/status";

export class BffError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "BffError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** True when the server could not be reached (offline, DNS, backend down): worth retrying later. */
  get isNetworkError(): boolean {
    return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504;
  }
}

export type BffMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type BffRequest = {
  method?: BffMethod;
  /** JSON body, or FormData for multipart uploads. */
  body?: unknown;
  signal?: AbortSignal;
  /**
   * On 401 (session over), go to /auth/expired?next=<current page> (default true).
   * The outbox replay sets it to false and keeps the item for later.
   */
  redirectOnUnauthorized?: boolean;
};

/** "/notifications?unread=true" -> "/bff/notifications?unread=true" (also accepts "/bff/..." and "/api/..."). */
export function bffUrl(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (clean.startsWith("/bff/")) return clean;
  if (clean.startsWith("/api/")) return `/bff/${clean.slice(5)}`;
  return `/bff${clean}`;
}

function goToExpired(): void {
  if (typeof window === "undefined") return;
  const next = `${window.location.pathname}${window.location.search}`;
  // A full navigation on purpose: /auth/expired is a Route Handler that clears the httpOnly cookies.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/auth/expired?next=${encodeURIComponent(next)}`);
}

/**
 * Calls the BFF and returns the parsed JSON (undefined for 204 / empty bodies).
 * Throws BffError: status 0 + NETWORK_ERROR when the request did not reach the server.
 */
export async function bffFetch<T = unknown>(path: string, request: BffRequest = {}): Promise<T> {
  const { method = "GET", body, signal, redirectOnUnauthorized = true } = request;
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(bffUrl(path), {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch (cause) {
    if ((cause as Error)?.name === "AbortError") throw cause;
    reportNetworkFailure();
    throw new BffError(0, "NETWORK_ERROR", "Can't reach the server.");
  }
  reportNetworkSuccess();

  const text = res.status === 204 ? "" : await res.text().catch(() => "");
  let data: unknown;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const err = (data && typeof data === "object" ? data : {}) as { error?: unknown; code?: unknown; details?: unknown };
    const code = typeof err.code === "string" ? err.code : res.status >= 500 ? "INTERNAL_ERROR" : "UNKNOWN_ERROR";
    const message = typeof err.error === "string" ? err.error : `Request failed with status ${res.status}.`;
    if (res.status === 401 && redirectOnUnauthorized) goToExpired();
    throw new BffError(res.status, code, message, err.details);
  }
  return data as T;
}
