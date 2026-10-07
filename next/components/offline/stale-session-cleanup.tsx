"use client";

import { useEffect } from "react";
import { clearStaleOfflineData } from "@/lib/offline/cleanup";

/**
 * Rendered by the auth pages (login, signup, password pages) when the request carried no session cookie.
 * A session that ended without "Log out" (browser closed, revoked or expired, password changed elsewhere)
 * may have left IndexedDB data, saved pages and a push subscription: they are removed here, for browsers or
 * plain-http deployments that ignore the `Clear-Site-Data` header (see proxy.ts).
 */
export function StaleSessionCleanup() {
  useEffect(() => {
    void clearStaleOfflineData();
  }, []);
  return null;
}
