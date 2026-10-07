import "server-only";
import { getTokenExpiry, getTokenSubject } from "@/lib/jwt";
import type { Session } from "@/lib/types";

/**
 * Session cookies. The tokens are httpOnly, so they are never readable from browser JS.
 *
 * - cl_access:   the backend access token (JWT). With "Keep me signed in": maxAge = remaining
 *                lifetime of the token; otherwise a browser-session cookie (the JWT still expires).
 * - cl_refresh:  the backend refresh token. 30 days with "Keep me signed in",
 *                otherwise a browser-session cookie.
 * - cl_remember: "1" / "0", remembers that choice so a refresh keeps the same cookie lifetime.
 * - cl_owner:    the signed-in user's id, NOT httpOnly and with the same lifetime as cl_refresh. No secret:
 *                the service worker (public/sw.js, Cookie Store API) only serves an offline page saved for
 *                this account while the session cookies exist (gone when the browser closes a
 *                non-remembered session, or when the session is cleared).
 * - cl_ended:    "1" for a couple of minutes after the session cookies were cleared (logout, revoked or
 *                expired session, password changed or reset): the next login/signup page answer carries
 *                `Clear-Site-Data` (proxy.ts), so nothing of the previous session stays on the device.
 *
 * Cookies can only be written in Server Actions, Route Handlers and the proxy,
 * so every helper takes the cookie jar to write to (`cookies()` or `response.cookies`).
 */

export const ACCESS_COOKIE = "cl_access";
export const REFRESH_COOKIE = "cl_refresh";
export const REMEMBER_COOKIE = "cl_remember";
export const OWNER_COOKIE = "cl_owner";
export const SESSION_ENDED_COOKIE = "cl_ended";

/**
 * Wipes the HTTP cache and every storage of this origin in the browser (Cache Storage with the offline
 * pages, IndexedDB, service worker registration and with it the push subscription). Cookies are kept
 * (language). Browsers only honour it in secure contexts (https, localhost); the login and signup pages
 * also clean up from JavaScript (components/offline/stale-session-cleanup.tsx).
 */
export const CLEAR_SITE_DATA_HEADER = "Clear-Site-Data";
export const CLEAR_SITE_DATA_VALUE = '"cache", "storage"';

const REFRESH_MAX_AGE = 30 * 24 * 60 * 60; // matches the backend's REFRESH_TOKEN_TTL_DAYS default
const DEFAULT_ACCESS_MAX_AGE = 15 * 60; // matches the backend's JWT_ACCESS_TTL default
const SESSION_ENDED_MAX_AGE = 2 * 60;

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

/** Secure in production; COOKIE_SECURE=true|false overrides it (e.g. `next start` over plain http in tests). */
export function secureCookies(): boolean {
  const override = process.env.COOKIE_SECURE;
  return override ? override === "true" : process.env.NODE_ENV === "production";
}

function baseOptions(): CookieOptions {
  return { httpOnly: true, secure: secureCookies(), sameSite: "lax", path: "/" };
}

function accessMaxAge(accessToken: string): number {
  const exp = getTokenExpiry(accessToken);
  if (exp === null) return DEFAULT_ACCESS_MAX_AGE;
  return Math.max(0, Math.floor(exp - Date.now() / 1000));
}

/** cl_owner = `owner`, with the lifetime of the refresh cookie ("Keep me signed in" or browser session). */
export function setOwnerCookie(jar: CookieJar, owner: string, remember: boolean): void {
  const options: CookieOptions = { ...baseOptions(), httpOnly: false };
  jar.set(OWNER_COOKIE, owner, remember ? { ...options, maxAge: REFRESH_MAX_AGE } : options);
}

export function setSessionCookies(
  jar: CookieJar,
  session: Pick<Session, "accessToken" | "refreshToken">,
  remember: boolean
): void {
  const base = baseOptions();
  if (remember) {
    jar.set(ACCESS_COOKIE, session.accessToken, { ...base, maxAge: accessMaxAge(session.accessToken) });
    jar.set(REFRESH_COOKIE, session.refreshToken, { ...base, maxAge: REFRESH_MAX_AGE });
    jar.set(REMEMBER_COOKIE, "1", { ...base, maxAge: REFRESH_MAX_AGE });
  } else {
    // No maxAge: browser-session cookies, dropped when the browser is closed.
    jar.set(ACCESS_COOKIE, session.accessToken, base);
    jar.set(REFRESH_COOKIE, session.refreshToken, base);
    jar.set(REMEMBER_COOKIE, "0", base);
  }
  const owner = getTokenSubject(session.accessToken);
  if (owner) setOwnerCookie(jar, owner, remember);
}

/** Ends the session in this browser; the next login/signup page then wipes the site's data (see cl_ended). */
export function clearSessionCookies(jar: CookieJar): void {
  const base = baseOptions();
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, REMEMBER_COOKIE]) {
    jar.set(name, "", { ...base, maxAge: 0 });
  }
  jar.set(OWNER_COOKIE, "", { ...base, httpOnly: false, maxAge: 0 });
  jar.set(SESSION_ENDED_COOKIE, "1", { ...base, maxAge: SESSION_ENDED_MAX_AGE });
}

/** Drops the cl_ended marker once a response has carried `Clear-Site-Data`. */
export function forgetSessionEnded(jar: CookieJar): void {
  jar.set(SESSION_ENDED_COOKIE, "", { ...baseOptions(), maxAge: 0 });
}
