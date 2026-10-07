/**
 * Reads the `exp` claim of a JWT WITHOUT verifying its signature.
 * Only used to decide when to refresh and how long to keep the cookie;
 * the backend still verifies every token it receives.
 */
function readPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const payload: unknown = JSON.parse(atob(padded));
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function getTokenExpiry(token: string): number | null {
  const exp = readPayload(token)?.exp;
  return typeof exp === "number" ? exp : null;
}

/**
 * The `sub` claim (user id) of a JWT, NOT verified. Only used to label offline copies with the account
 * they belong to (lib/session.ts, proxy.ts); every page still checks the token with the backend.
 */
export function getTokenSubject(token: string): string | null {
  const sub = readPayload(token)?.sub;
  return typeof sub === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(sub) ? sub : null;
}

/** Seconds before expiry at which a token is already considered stale. */
const EXPIRY_LEEWAY_SECONDS = 30;

/** True if the token is not expired (or expiring within the leeway). Tokens without `exp` count as fresh. */
export function isTokenFresh(token: string, now = Date.now()): boolean {
  const exp = getTokenExpiry(token);
  if (exp === null) return true;
  return exp * 1000 - now > EXPIRY_LEEWAY_SECONDS * 1000;
}
