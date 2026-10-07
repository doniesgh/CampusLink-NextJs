import { NextResponse, type NextRequest } from "next/server";
import { loginPath } from "@/lib/safe-next";
import { clearSessionCookies } from "@/lib/session";

/**
 * GET /auth/expired?next=/dashboard
 *
 * Used by protected pages when the backend rejects the access token (revoked, user
 * deleted, ...). Pages can't modify cookies while rendering, so they redirect here:
 * we clear the session cookies and send the user to /login?next=...
 */
export function GET(request: NextRequest) {
  const response = NextResponse.redirect(
    new URL(loginPath(request.nextUrl.searchParams.get("next")), request.url)
  );
  clearSessionCookies(response.cookies);
  return response;
}
