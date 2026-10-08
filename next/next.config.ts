import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl without locale routing: the request config reads the NEXT_LOCALE cookie (see i18n/request.ts).
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const isProduction = process.env.NODE_ENV === "production";

// The page Content-Security-Policy needs a fresh nonce per request: it is set by proxy.ts.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Camera, microphone and geolocation are not used in phase 1.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  // HTTPS only for two years, subdomains included (browsers ignore it on plain-http answers, e.g. local tests).
  ...(isProduction ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

// The backend's MAX_UPLOAD_MB (default 10). The announcement composer (saveAnnouncementAction, a Server Action)
// uploads up to 5 files of that size: 5 x MAX_UPLOAD_MB + 1 MB for the other fields and the multipart framing,
// i.e. "51mb" by default (the BFF uses the same limit, lib/bff.ts).
const parsedUploadMb = Number.parseInt(process.env.MAX_UPLOAD_MB ?? "", 10);
const maxUploadMb = parsedUploadMb > 0 ? parsedUploadMb : 10;
const uploadBodyLimit = `${5 * maxUploadMb + 1}mb` as const;

const nextConfig: NextConfig = {
  // NEXT_DIST_DIR lets several builds/servers of this folder run side by side (tests, parallel work).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: uploadBodyLimit,
    },
    // Server Actions of /dashboard pages go through proxy.ts (token refresh), which buffers request bodies up to
    // this size (default 10 MB): beyond it the action only gets a truncated form ("Unexpected end of form").
    proxyClientMaxBodySize: uploadBodyLimit,
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // The service worker must always be revalidated, so updates reach users quickly.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
      {
        // Private API data relayed by the BFF is never stored by the browser or shared caches.
        source: "/bff/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
