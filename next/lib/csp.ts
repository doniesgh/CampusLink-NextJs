// Content-Security-Policy of the pages, with a fresh nonce per request (set by proxy.ts).
// Next.js reads the nonce from the request's CSP header and puts it on its own scripts and inline styles,
// so every page must be rendered dynamically (they all are: the root layout reads the locale cookie).
// See node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md.

export const CSP_HEADER = "Content-Security-Policy";

/** 128 random bits, base64 (unpredictable, single use). */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCodePoint(...bytes));
}

/**
 * - scripts: only those carrying the nonce, plus what they load ('strict-dynamic'; 'self' is then ignored by
 *   CSP3 browsers and only kept for older ones). `next dev` also needs 'unsafe-eval' (React debug stacks).
 * - styles: <style>/<link> elements need the nonce or this origin (`style-src-elem`): Next.js adds the nonce to
 *   its inline styles, and Radix dialogs/menus get it through get-nonce (components/security/style-nonce.tsx).
 *   Inline `style="…"` attributes stay allowed (`style-src-attr`): React renders some on the server (progress
 *   bars, subject colours, Radix positioning). `style-src` is the fallback of browsers without the CSP3
 *   -elem/-attr directives. In development Turbopack injects unnamed <style> tags: inline styles allowed.
 * - connections: this origin and the real-time server (NEXT_PUBLIC_REALTIME_URL, http(s) + ws(s), phase 3 chat);
 *   `next dev` also allows local WebSockets (development tools that run beside
 *   the dev server, e.g. React DevTools or editor extensions forwarding the browser console).
 * - workers and the manifest: this origin only (the service worker /sw.js has its own policy, next.config.ts).
 */
/** Origins of the real-time server (Socket.IO): its http(s) origin and the matching ws(s) one. */
function realtimeSources(): string {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_REALTIME_URL || "http://localhost:4000");
    const ws = url.protocol === "https:" ? "wss:" : "ws:";
    return ` ${url.origin} ${ws}//${url.host}`;
  } catch {
    return "";
  }
}

export function contentSecurityPolicy(nonce: string, dev = process.env.NODE_ENV === "development"): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    ...(dev ? [] : [`style-src-elem 'self' 'nonce-${nonce}'`, "style-src-attr 'unsafe-inline'"]),
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${realtimeSources()}${dev ? " ws://localhost:* ws://127.0.0.1:*" : ""}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
