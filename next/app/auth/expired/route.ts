import { NextResponse, type NextRequest } from "next/server";
import { loginPath } from "@/lib/safe-next";
import { CLEAR_SITE_DATA_HEADER, CLEAR_SITE_DATA_VALUE, clearSessionCookies } from "@/lib/session";

/**
 * GET /auth/expired?next=/dashboard
 *
 * Used by protected pages when the backend rejects the access token (revoked, user
 * deleted, ...). Pages can't modify cookies while rendering, so they redirect here:
 * we clear the session cookies and send the user to /login?next=...
 *
 * The session is over, so the answer also carries `Clear-Site-Data: "cache", "storage"`: the browser drops
 * the offline copies, IndexedDB, the service worker and its push subscription (the login page this leads to
 * repeats it, see proxy.ts, and cleans up from JavaScript where the header is not supported).
 *
 * Cookies are only cleared for same-origin navigations (`Sec-Fetch-Site: same-origin`, or `none`
 * when the user typed the URL): another site linking here (`cross-site` / `same-site`) can't sign
 * the user out; such requests are sent to the home page untouched. Browsers only send Fetch Metadata
 * in secure contexts (https, localhost): without the header we keep the previous behaviour, otherwise
 * a plain-http deployment could never leave a revoked session.
 */
const BLOCKED_FETCH_SITES = new Set(["cross-site", "same-site"]);

export function GET(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  if (site && BLOCKED_FETCH_SITES.has(site)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const response = NextResponse.redirect(
    new URL(loginPath(request.nextUrl.searchParams.get("next")), request.url)
  );
  clearSessionCookies(response.cookies);
  response.headers.set(CLEAR_SITE_DATA_HEADER, CLEAR_SITE_DATA_VALUE);
  return response;
}
