"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { safeNextPath } from "@/lib/safe-next";

/** Production builds, or NEXT_PUBLIC_ENABLE_SW=true (e.g. to try push/offline with `next dev`). */
export const SERVICE_WORKER_ENABLED =
  process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ENABLE_SW === "true";

const SW_URL = "/sw.js";
const SW_OPTIONS: RegistrationOptions = { scope: "/", updateViaCache: "none" };

/** The worker decides what it keeps (offline module pages only, labelled with their owner). */
function cacheCurrentPage(): void {
  const controller = navigator.serviceWorker?.controller;
  if (!controller) return;
  controller.postMessage({ type: "CACHE_PAGE", url: `${window.location.pathname}${window.location.search}` });
}

/** Registers the worker again when it is gone, e.g. after a `Clear-Site-Data: "storage"` at the end of a session. */
function ensureRegistered(): void {
  navigator.serviceWorker
    .getRegistration("/")
    .then((registration) => (registration ? undefined : navigator.serviceWorker.register(SW_URL, SW_OPTIONS)))
    .catch(() => undefined);
}

/**
 * Registers /sw.js (scope "/"). In development without NEXT_PUBLIC_ENABLE_SW it unregisters any
 * worker left by a production run, so `next dev` never serves stale cached code.
 *
 * Client-side navigations don't go through the worker's navigation handler, so after each route
 * change the page asks the worker to save the current URL for offline reloads. Each route change also
 * re-registers the worker if the end of a session removed it (Clear-Site-Data).
 */
export function ServiceWorkerRegistrar() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (!SERVICE_WORKER_ENABLED) {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .catch(() => undefined);
      return;
    }

    navigator.serviceWorker.register(SW_URL, SW_OPTIONS).catch(() => undefined);
    // Notification click while the page is not controlled by the worker: it asks the page to navigate.
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null;
      if (data?.type !== "NAVIGATE") return;
      const target = safeNextPath(typeof data.url === "string" ? data.url : null);
      if (target) router.push(target);
    };
    navigator.serviceWorker.addEventListener("controllerchange", cacheCurrentPage);
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", cacheCurrentPage);
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, [router]);

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (!SERVICE_WORKER_ENABLED || !("serviceWorker" in navigator)) return;
    if (isFirstRender.current) isFirstRender.current = false;
    else ensureRegistered();
    cacheCurrentPage();
  }, [pathname]);

  return null;
}
