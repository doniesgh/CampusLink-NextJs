"use client";

import type { ComponentProps } from "react";
import Link from "next/link";
import { useOnlineStatus } from "@/lib/offline/status";

/**
 * `next/link` that never prefetches while offline (same props as Link).
 *
 * Prefetches (link in the viewport, hover, touch) fail without a network and each failure is logged as
 * `net::ERR_INTERNET_DISCONNECTED` in the console. Offline, a click still navigates: the service worker
 * answers full navigations with the saved page (or /offline). Prefetching resumes when the connection is back.
 * Use it for the app shell and other links that are always visible on pages available offline.
 */
export default function AppLink({ prefetch, ...props }: ComponentProps<typeof Link>) {
  const online = useOnlineStatus();
  return <Link {...props} prefetch={online ? prefetch : false} />;
}
