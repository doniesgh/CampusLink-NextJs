// The signed-in user owning the offline data. Every IndexedDB record is tagged with it, so a
// different account on the same browser never sees (or replays) someone else's data.
import { createContext, useContext } from "react";

export const DataOwnerContext = createContext<string | null>(null);

/** Owner id for hooks (null outside the dashboard: data is then kept in memory only). */
export function useDataOwner(): string | null {
  return useContext(DataOwnerContext);
}

let currentOwner: string | null = null;

/** Set by <DataLayerProvider> (components/offline/data-layer-provider.tsx). */
export function setCurrentOwner(owner: string | null): void {
  currentOwner = owner;
}

/** Owner for imperative code (queueMutation, replay). */
export function getCurrentOwner(): string | null {
  return currentOwner;
}
