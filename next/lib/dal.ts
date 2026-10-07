import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { api, toApiError, type ApiError } from "@/lib/api";
import { ACCESS_COOKIE } from "@/lib/session";
import { loginPath } from "@/lib/safe-next";
import type { User } from "@/lib/types";

export type CurrentUser = { user: User; error?: undefined } | { user?: undefined; error: ApiError };

/**
 * Loads the signed-in user for a protected page (memoised per request).
 *
 * The proxy has already refreshed an expiring access token, so here:
 * - no access cookie -> redirect to /login?next=<returnTo>
 * - backend answers 401 (token revoked, user deleted, ...) -> /auth/expired clears the
 *   cookies and sends the user to the login page (cookies can't be cleared while rendering)
 * - any other failure (e.g. backend unreachable) is returned for the page to display.
 */
export const getCurrentUser = cache(async (returnTo: string): Promise<CurrentUser> => {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect(loginPath(returnTo));

  let error: ApiError;
  try {
    const user = await api<User>("/api/users/me", { token });
    return { user };
  } catch (e) {
    error = toApiError(e);
  }

  if (error.status === 401) {
    redirect(`/auth/expired?next=${encodeURIComponent(returnTo)}`);
  }
  return { error };
});
