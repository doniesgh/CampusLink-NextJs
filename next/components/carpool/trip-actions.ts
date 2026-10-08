import type { TripDetail } from "@/lib/carpool/types";

/** What the trip Server Actions return (ActionState of app/(back)/dashboard/carpool/actions.ts). */
export type TripActionResult = {
  ok?: boolean;
  message?: string;
  code?: string;
  fieldErrors?: Record<string, string>;
  data?: { trip?: TripDetail; reload?: boolean };
  at?: number;
};

/**
 * Runs a trip Server Action for the section `anchor`: the returned trip replaces the page's data, the outcome
 * is shown in that section (one status / alert at a time on the page). Resolves to null when the server could
 * not be reached.
 */
export type TripActionRunner = (anchor: string, action: () => Promise<TripActionResult>) => Promise<TripActionResult | null>;
