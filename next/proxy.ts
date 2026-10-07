import { NextResponse, type NextRequest } from "next/server";
import { api, toApiError } from "@/lib/api";
import { isTokenFresh } from "@/lib/jwt";
import { loginPath } from "@/lib/safe-next";
import {
  ACCESS_COOKIE,
  clearSessionCookies,
  REFRESH_COOKIE,
  REMEMBER_COOKIE,
  setSessionCookies,
} from "@/lib/session";
import type { Session } from "@/lib/types";

/**
 * Route protection + transparent token refresh (Next 16 "proxy", formerly "middleware").
 *
 * Server Components can't write cookies, so this is where an expired access token is
 * exchanged for a new pair (POST /api/auth/refresh) before the page renders:
 * the new cookies go on the response, and are also injected into the forwarded
 * request so the page rendered for this very request already sees them.
 *
 * - /dashboard/*: no usable session -> /login?next=<path>
 * - /login, /signup: already signed in -> /dashboard
 *
 * Redirects only apply to page navigations (GET/HEAD). Server Action POSTs go through
 * untouched (actions check the session themselves), so e.g. "Log out" always works.
 */

const GUEST_ONLY = new Set(["/login", "/signup"]);

function isProtected(pathname: string): boolean {
  return pathname === "/dashboard" || pathname.startsWith("/dashboard/");
}

type RefreshResult =
  | { ok: true; session: Session }
  | { ok: false; invalid: boolean };

async function refreshSession(refreshToken: string): Promise<RefreshResult> {
  try {
    const session = await api<Session>("/api/auth/refresh", { body: { refreshToken } });
    return { ok: true, session };
  } catch (e) {
    const error = toApiError(e);
    // 400/401: the refresh token is unusable. Network/server errors: keep the session, the page reports the problem.
    return { ok: false, invalid: error.status === 400 || error.status === 401 };
  }
}

function redirectTo(request: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, request.url));
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isNavigation = request.method === "GET" || request.method === "HEAD";
  const guestOnly = GUEST_ONLY.has(pathname) && isNavigation;
  const protectedRoute = isProtected(pathname);
  const loginUrl = loginPath(`${pathname}${search}`);

  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

  // 1. Valid access token.
  if (accessToken && isTokenFresh(accessToken)) {
    return guestOnly ? redirectTo(request, "/dashboard") : NextResponse.next();
  }

  // 2. No way to refresh.
  if (!refreshToken) {
    if (!protectedRoute || !isNavigation) return NextResponse.next();
    const response = redirectTo(request, loginUrl);
    if (accessToken) clearSessionCookies(response.cookies);
    return response;
  }

  // 3. Expired/missing access token but a refresh token: get a new pair.
  const result = await refreshSession(refreshToken);

  if (result.ok) {
    const remember = request.cookies.get(REMEMBER_COOKIE)?.value === "1";
    if (guestOnly) {
      const response = redirectTo(request, "/dashboard");
      setSessionCookies(response.cookies, result.session, remember);
      return response;
    }
    request.cookies.set(ACCESS_COOKIE, result.session.accessToken);
    request.cookies.set(REFRESH_COOKIE, result.session.refreshToken);
    const response = NextResponse.next({ request });
    setSessionCookies(response.cookies, result.session, remember);
    return response;
  }

  if (result.invalid) {
    request.cookies.delete(ACCESS_COOKIE);
    request.cookies.delete(REFRESH_COOKIE);
    const response =
      protectedRoute && isNavigation ? redirectTo(request, loginUrl) : NextResponse.next({ request });
    clearSessionCookies(response.cookies);
    return response;
  }

  // Backend unreachable: let the page render and show the error (no redirect loop).
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/signup"],
};
