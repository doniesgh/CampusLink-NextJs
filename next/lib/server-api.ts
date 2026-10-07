import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { api, toApiError, type ApiError, type ApiMethod } from "@/lib/api";
import { getErrorFormatter } from "@/lib/i18n/server";
import { safeNextPath } from "@/lib/safe-next";
import { ACCESS_COOKIE } from "@/lib/session";

/**
 * Backend calls from Server Components and Server Actions, as the signed-in user.
 *
 * - `path` is relative to the API root: "/users/me" -> `${API_URL}/api/users/me` ("/api/..." also works).
 * - The access token comes from the httpOnly cookie (the proxy has already refreshed it for
 *   /dashboard pages and their Server Actions); the browser's User-Agent (and its address when a trusted
 *   proxy gave it, see clientForwardHeaders) are forwarded.
 * - Throws ApiError (status 0 + NETWORK_ERROR when the backend is unreachable).
 */
export async function serverApi<T>(path: string, options: { method?: ApiMethod; body?: unknown } = {}): Promise<T> {
  const [jar, headerList] = await Promise.all([cookies(), headers()]);
  const token = jar.get(ACCESS_COOKIE)?.value;
  const apiPath = path.startsWith("/api/") ? path : `/api${path.startsWith("/") ? path : `/${path}`}`;
  return api<T>(apiPath, { ...options, token, forward: headerList });
}

/** Like serverApi, but returns `fallback` instead of throwing (optional data on a page). */
export async function serverApiOr<T>(path: string, fallback: T): Promise<T> {
  try {
    return await serverApi<T>(path);
  } catch {
    return fallback;
  }
}

/**
 * Server-side data for a Client Component's `useOfflineQuery({ fallbackData, fallbackSavedAt })`:
 * `{ data, savedAt }` where savedAt is when it was fetched (ms). `data` is `fallback` on failure.
 *
 *   const snapshot = await serverSnapshot<NotificationList | null>("/notifications?limit=20", null);
 *   <MyList initial={snapshot} />   // useOfflineQuery(key, path, { fallbackData: initial.data ?? undefined,
 *                                   //   fallbackSavedAt: initial.savedAt, revalidateOnMount: !initial.data })
 */
export async function serverSnapshot<T>(path: string, fallback: T): Promise<{ data: T; savedAt: number }> {
  const data = await serverApiOr<T>(path, fallback);
  return { data, savedAt: Date.now() };
}

/** Path + query of the page being rendered (set by proxy.ts as `x-cl-path` for /dashboard routes). */
export async function currentPath(fallback = "/dashboard"): Promise<string> {
  const value = (await headers()).get("x-cl-path");
  return safeNextPath(value) ?? fallback;
}

/**
 * State returned by Server Actions to `useActionState` forms (see components/ui/feedback.tsx).
 * `message` goes to a role="status" region when ok, to role="alert" otherwise.
 */
export type ActionState<T = undefined> = {
  ok?: boolean;
  message?: string;
  code?: string;
  fieldErrors?: Record<string, string>;
  /** Non-secret values to put back in the inputs after a failed submit (React resets the form). */
  values?: Record<string, string>;
  data?: T;
  /** Changes on every response so an identical message is announced again. */
  at?: number;
};

export function actionSuccess<T = undefined>(message?: string, extra: Partial<ActionState<T>> = {}): ActionState<T> {
  return { ok: true, message, at: Date.now(), ...extra };
}

/**
 * Turns anything thrown by serverApi() into a localised failed ActionState.
 * A 401 (session revoked, user deleted) sends the user to /auth/expired, which clears the cookies.
 */
export async function actionFailure<T = undefined>(
  error: unknown,
  extra: Partial<ActionState<T>> = {}
): Promise<ActionState<T>> {
  const apiError: ApiError = toApiError(error);
  if (apiError.status === 401) {
    redirect(`/auth/expired?next=${encodeURIComponent(await currentPath())}`);
  }
  const formatter = await getErrorFormatter();
  return {
    ok: false,
    code: apiError.code,
    message: formatter.message(apiError),
    fieldErrors: formatter.fieldErrors(apiError),
    at: Date.now(),
    ...extra,
  };
}
