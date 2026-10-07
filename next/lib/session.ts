import "server-only";
import { getTokenExpiry } from "@/lib/jwt";
import type { Session } from "@/lib/types";

/**
 * Session cookies. All are httpOnly, so tokens are never readable from browser JS.
 *
 * - cl_access:   the backend access token (JWT). maxAge = remaining lifetime of the token.
 * - cl_refresh:  the backend refresh token. 30 days with "Keep me signed in",
 *                otherwise a browser-session cookie.
 * - cl_remember: "1" / "0", remembers that choice so a refresh keeps the same cookie lifetime.
 *
 * Cookies can only be written in Server Actions, Route Handlers and the proxy,
 * so every helper takes the cookie jar to write to (`cookies()` or `response.cookies`).
 */

export const ACCESS_COOKIE = "cl_access";
export const REFRESH_COOKIE = "cl_refresh";
export const REMEMBER_COOKIE = "cl_remember";

const REFRESH_MAX_AGE = 30 * 24 * 60 * 60; // matches the backend's REFRESH_TOKEN_TTL_DAYS default
const DEFAULT_ACCESS_MAX_AGE = 15 * 60; // matches the backend's JWT_ACCESS_TTL default

type CookieOptions = {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  path?: string;
  maxAge?: number;
};

/** Anything with a Next-style cookie `set` (the `cookies()` store or `NextResponse#cookies`). */
export type CookieJar = {
  set(name: string, value: string, options?: CookieOptions): unknown;
};

function baseOptions(): CookieOptions {
  // Secure in production; COOKIE_SECURE=true|false overrides it (e.g. `next start` over plain http in tests).
  const override = process.env.COOKIE_SECURE;
  const secure = override ? override === "true" : process.env.NODE_ENV === "production";
  return { httpOnly: true, secure, sameSite: "lax", path: "/" };
}

function accessMaxAge(accessToken: string): number {
  const exp = getTokenExpiry(accessToken);
  if (exp === null) return DEFAULT_ACCESS_MAX_AGE;
  return Math.max(0, Math.floor(exp - Date.now() / 1000));
}

export function setSessionCookies(
  jar: CookieJar,
  session: Pick<Session, "accessToken" | "refreshToken">,
  remember: boolean
): void {
  const base = baseOptions();
  jar.set(ACCESS_COOKIE, session.accessToken, { ...base, maxAge: accessMaxAge(session.accessToken) });
  if (remember) {
    jar.set(REFRESH_COOKIE, session.refreshToken, { ...base, maxAge: REFRESH_MAX_AGE });
    jar.set(REMEMBER_COOKIE, "1", { ...base, maxAge: REFRESH_MAX_AGE });
  } else {
    // No maxAge: browser-session cookies, dropped when the browser is closed.
    jar.set(REFRESH_COOKIE, session.refreshToken, base);
    jar.set(REMEMBER_COOKIE, "0", base);
  }
}

export function clearSessionCookies(jar: CookieJar): void {
  const base = baseOptions();
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, REMEMBER_COOKIE]) {
    jar.set(name, "", { ...base, maxAge: 0 });
  }
}
