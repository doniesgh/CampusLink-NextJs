/**
 * Returns `next` only if it is a safe same-origin relative path ("/dashboard?tab=1"),
 * otherwise null. Rejects absolute URLs, protocol-relative URLs ("//evil.com"),
 * backslash tricks ("/\\evil.com") and control characters.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || typeof next !== "string") return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(next)) return null;

  try {
    const base = "http://campuslink.invalid";
    const url = new URL(next, base);
    if (url.origin !== base) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** "/login?next=/dashboard" (slashes kept readable, everything else encoded). */
export function loginPath(next?: string | null): string {
  const safe = safeNextPath(next);
  if (!safe) return "/login";
  return `/login?next=${encodeURIComponent(safe).replace(/%2F/gi, "/")}`;
}
