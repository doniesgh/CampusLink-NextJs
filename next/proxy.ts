import { NextResponse, type NextRequest } from "next/server";
import { toApiError } from "@/lib/api";
import { getTokenSubject, isTokenFresh } from "@/lib/jwt";
import { refreshSessionOnce } from "@/lib/refresh";
import { loginPath } from "@/lib/safe-next";
import {
  ACCESS_COOKIE,
  CLEAR_SITE_DATA_HEADER,
  CLEAR_SITE_DATA_VALUE,
  clearSessionCookies,
  forgetSessionEnded,
  OWNER_COOKIE,
  REFRESH_COOKIE,
  REMEMBER_COOKIE,
  SESSION_ENDED_COOKIE,
  setOwnerCookie,
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
 *
 * For /dashboard routes the current path is passed to Server Components as the `x-cl-path`
 * request header (used by lib/dal.ts for "/login?next=..." redirects).
 *
 * Role checks are NOT done here (the role inside the JWT may be stale): pages call
 * `requireRole()` from lib/dal.ts, which uses the fresh user from the backend.
 *
 * Offline data and the end of a session:
 * - /dashboard pages carry `x-cl-owner: <user id>` (from the token): public/sw.js labels its offline copies
 *   with it. The readable `cl_owner` cookie is (re)set when missing or stale (lib/session.ts).
 * - A login/signup page rendered without a session, right after the session cookies were cleared (`cl_ended`,
 *   set by clearSessionCookies: logout, revoked session, password changed or reset) or because the refresh
 *   token was just rejected, carries `Clear-Site-Data: "cache", "storage"`. When a Server Action redirects
 *   there, Next.js copies that header onto the action's own answer.
 */

const GUEST_ONLY = new Set(["/login", "/signup"]);
const PATH_HEADER = "x-cl-path";
/** Sent by public/sw.js when it saves a page in the background. */
const BACKGROUND_HEADER = "x-cl-background";
/** Read by public/sw.js: the account an offline copy of a dashboard page belongs to. */
const OWNER_HEADER = "x-cl-owner";

function isProtected(pathname: string): boolean {
  return pathname === "/dashboard" || pathname.startsWith("/dashboard/");
}

type RefreshResult =
  | { ok: true; session: Session }
  | { ok: false; invalid: boolean };

async function refreshSession(refreshToken: string, request: NextRequest): Promise<RefreshResult> {
  try {
    const session = await refreshSessionOnce(refreshToken, request.headers);
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

/** Continues to the page, passing the (possibly updated) request headers plus x-cl-path. */
function next(request: NextRequest, protectedRoute: boolean): NextResponse {
  const requestHeaders = new Headers(request.headers);
  if (protectedRoute) {
    requestHeaders.set(PATH_HEADER, `${request.nextUrl.pathname}${request.nextUrl.search}`);
  } else {
    requestHeaders.delete(PATH_HEADER);
  }
  return NextResponse.next({ request: { headers: requestHeaders } });
}

/** Labels a dashboard answer with its owner (service worker copies) and keeps the cl_owner cookie in step. */
function withOwner(response: NextResponse, request: NextRequest, accessToken: string): NextResponse {
  const owner = getTokenSubject(accessToken);
  if (!owner) return response;
  response.headers.set(OWNER_HEADER, owner);
  if (request.cookies.get(OWNER_COOKIE)?.value !== owner) {
    setOwnerCookie(response.cookies, owner, request.cookies.get(REMEMBER_COOKIE)?.value === "1");
  }
  return response;
}

/** Login/signup page shown after a session ended: the browser drops everything the session left. */
function clearSiteData(response: NextResponse): NextResponse {
  response.headers.set(CLEAR_SITE_DATA_HEADER, CLEAR_SITE_DATA_VALUE);
  forgetSessionEnded(response.cookies);
  return response;
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
    if (guestOnly) return redirectTo(request, "/dashboard");
    const response = next(request, protectedRoute);
    return protectedRoute && isNavigation ? withOwner(response, request, accessToken) : response;
  }

  // 2. No way to refresh.
  if (!refreshToken) {
    if (!protectedRoute || !isNavigation) {
      const response = next(request, protectedRoute);
      return guestOnly && request.cookies.has(SESSION_ENDED_COOKIE) ? clearSiteData(response) : response;
    }
    const response = redirectTo(request, loginUrl);
    if (accessToken) clearSessionCookies(response.cookies);
    return response;
  }

  // Background page fetches of the service worker (offline copies) never rotate tokens.
  if (request.headers.get(BACKGROUND_HEADER) === "1") return new NextResponse(null, { status: 204 });

  // 3. Expired/missing access token but a refresh token: get a new pair.
  const result = await refreshSession(refreshToken, request);

  if (result.ok) {
    const remember = request.cookies.get(REMEMBER_COOKIE)?.value === "1";
    if (guestOnly) {
      const response = redirectTo(request, "/dashboard");
      setSessionCookies(response.cookies, result.session, remember);
      return response;
    }
    request.cookies.set(ACCESS_COOKIE, result.session.accessToken);
    request.cookies.set(REFRESH_COOKIE, result.session.refreshToken);
    const response = next(request, protectedRoute);
    setSessionCookies(response.cookies, result.session, remember);
    const owner = getTokenSubject(result.session.accessToken);
    if (protectedRoute && isNavigation && owner) response.headers.set(OWNER_HEADER, owner);
    return response;
  }

  if (result.invalid) {
    request.cookies.delete(ACCESS_COOKIE);
    request.cookies.delete(REFRESH_COOKIE);
    const response =
      protectedRoute && isNavigation ? redirectTo(request, loginUrl) : next(request, protectedRoute);
    clearSessionCookies(response.cookies);
    // Otherwise the login page this redirect leads to wipes the site data (cl_ended).
    return guestOnly ? clearSiteData(response) : response;
  }

  // Backend unreachable: let the page render and show the error (no redirect loop).
  return next(request, protectedRoute);
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/signup"],
};
