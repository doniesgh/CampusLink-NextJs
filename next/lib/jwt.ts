/**
 * Reads the `exp` claim of a JWT WITHOUT verifying its signature.
 * Only used to decide when to refresh and how long to keep the cookie;
 * the backend still verifies every token it receives.
 */
export function getTokenExpiry(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const payload: unknown = JSON.parse(atob(padded));
    const exp = (payload as { exp?: unknown } | null)?.exp;
    return typeof exp === "number" ? exp : null;
  } catch {
    return null;
  }
}

/** Seconds before expiry at which a token is already considered stale. */
const EXPIRY_LEEWAY_SECONDS = 30;

/** True if the token is not expired (or expiring within the leeway). Tokens without `exp` count as fresh. */
export function isTokenFresh(token: string, now = Date.now()): boolean {
  const exp = getTokenExpiry(token);
  if (exp === null) return true;
  return exp * 1000 - now > EXPIRY_LEEWAY_SECONDS * 1000;
}
