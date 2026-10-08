"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * false while the server HTML is shown, true once React has hydrated the component. The carpool forms expose it
 * as `data-ready="true"`: a change made before hydration (e.g. an end-to-end test selecting an option right after
 * the page loaded) is reset by React, so tests wait for that attribute before using the controls.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false
  );
}
