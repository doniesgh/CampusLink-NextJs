import "server-only";

/**
 * Server-side client for the CampusLink backend.
 *
 * The browser never talks to the backend directly: Server Actions, Route Handlers
 * and the proxy call it through this wrapper, and tokens live in httpOnly cookies.
 */

export const API_URL = (process.env.API_URL || "http://localhost:4000").replace(/\/+$/, "");

const REQUEST_TIMEOUT_MS = 10_000;

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

type ApiOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Access token sent as `Authorization: Bearer <token>`. */
  token?: string;
};

type ErrorBody = { error?: unknown; code?: unknown; details?: unknown };

/**
 * Calls the backend and returns the parsed JSON body (undefined for 204).
 * Throws an ApiError for any non-2xx answer; network failures and timeouts
 * become an ApiError with status 0 and code NETWORK_ERROR.
 */
export async function api<T>(path: string, { method, body, token }: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new ApiError(0, "NETWORK_ERROR", "Can't reach the server.", undefined, { cause });
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text().catch(() => "");
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!res.ok) {
    const err = (data && typeof data === "object" ? data : {}) as ErrorBody;
    const code =
      typeof err.code === "string" ? err.code : res.status >= 500 ? "INTERNAL_ERROR" : "UNKNOWN_ERROR";
    const message =
      typeof err.error === "string" ? err.error : `Request failed with status ${res.status}.`;
    throw new ApiError(res.status, code, message, err.details);
  }

  return data as T;
}

/** Normalises anything thrown by `api()` (or by our own code) into an ApiError. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(500, "INTERNAL_ERROR", "Unexpected error.", undefined, { cause: error });
}
