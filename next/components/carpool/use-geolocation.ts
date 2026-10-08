"use client";

import { useCallback, useEffect, useState } from "react";
import type { LatLng } from "@/lib/carpool/geo";

export type GeoErrorReason = "denied" | "unavailable" | "timeout" | "unsupported";

export type GeoState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "located"; point: LatLng; accuracy: number | null }
  | { status: "error"; reason: GeoErrorReason };

const OPTIONS: PositionOptions = { enableHighAccuracy: false, timeout: 15_000, maximumAge: 120_000 };

/**
 * The browser's Geolocation API with clear outcomes ("Use my location"):
 * - nothing is asked before the user clicks; the browser shows its own permission prompt then;
 * - a permission already blocked for the site (Permissions API) is reported at once, without a prompt;
 * - insecure origins (plain http other than localhost) and browsers without the API: "unsupported";
 * - errors: denied, unavailable, timeout.
 * The position stays in memory only (never in the address, never saved).
 */
export function useGeolocation() {
  const [state, setState] = useState<GeoState>({ status: "idle" });
  const [permission, setPermission] = useState<PermissionState | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return;
    let cancelled = false;
    let watched: PermissionStatus | null = null;
    const onChange = () => setPermission(watched?.state ?? null);
    navigator.permissions
      .query({ name: "geolocation" })
      .then((status) => {
        if (cancelled) return;
        watched = status;
        setPermission(status.state);
        status.addEventListener("change", onChange);
      })
      .catch(() => {
        // Permissions API without "geolocation" (older browsers): the prompt will tell.
      });
    return () => {
      cancelled = true;
      watched?.removeEventListener("change", onChange);
    };
  }, []);

  const locate = useCallback(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator) || (typeof window !== "undefined" && !window.isSecureContext)) {
      setState({ status: "error", reason: "unsupported" });
      return;
    }
    if (permission === "denied") {
      setState({ status: "error", reason: "denied" });
      return;
    }
    setState({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      (position) =>
        setState({
          status: "located",
          point: { lat: position.coords.latitude, lng: position.coords.longitude },
          accuracy: Number.isFinite(position.coords.accuracy) ? Math.round(position.coords.accuracy) : null,
        }),
      (error) =>
        setState({
          status: "error",
          reason: error.code === error.PERMISSION_DENIED ? "denied" : error.code === error.TIMEOUT ? "timeout" : "unavailable",
        }),
      OPTIONS
    );
  }, [permission]);

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { state, permission, locate, reset };
}
