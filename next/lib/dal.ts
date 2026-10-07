import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { api, toApiError, type ApiError } from "@/lib/api";
import { safeNextPath, loginPath } from "@/lib/safe-next";
import { ACCESS_COOKIE } from "@/lib/session";
import type { Role, User } from "@/lib/types";

export type CurrentUser = { user: User; error?: undefined } | { user?: undefined; error: ApiError };

/** Path + query of the protected page being rendered (proxy.ts sets `x-cl-path`). */
async function pagePath(): Promise<string> {
  return safeNextPath((await headers()).get("x-cl-path")) ?? "/dashboard";
}

// One backend call per request and token, shared by the layout and the page.
const fetchMe = cache(async (token: string): Promise<CurrentUser> => {
  try {
    const user = await api<User>("/api/users/me", { token, forward: await headers() });
    return { user };
  } catch (e) {
    return { error: toApiError(e) };
  }
});

/**
 * Loads the signed-in user for a protected page or layout (memoised per request).
 *
 * The proxy has already refreshed an expiring access token, so here:
 * - no access cookie -> redirect to /login?next=<returnTo>
 * - backend answers 401 (token revoked, user deleted, ...) -> /auth/expired clears the
 *   cookies and sends the user to the login page (cookies can't be cleared while rendering)
 * - any other failure (e.g. backend unreachable) is returned for the page to display.
 *
 * `returnTo` defaults to the current page (from the proxy).
 */
export async function getCurrentUser(returnTo?: string): Promise<CurrentUser> {
  const target = returnTo ?? (await pagePath());
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect(loginPath(target));

  const result = await fetchMe(token);
  if (result.error?.status === 401) {
    redirect(`/auth/expired?next=${encodeURIComponent(target)}`);
  }
  return result;
}

/**
 * Role guard for pages: like getCurrentUser, and redirects to /dashboard when the signed-in
 * user's role is not in `roles`. Backend failures are returned for the page to display.
 *
 *   const { user, error } = await requireRole(["ADMIN"]);
 */
export async function requireRole(roles: readonly Role[], returnTo?: string): Promise<CurrentUser> {
  const result = await getCurrentUser(returnTo);
  if (result.user && !roles.includes(result.user.role)) redirect("/dashboard");
  return result;
}
