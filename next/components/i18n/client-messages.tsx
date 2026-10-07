import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import type { Namespace } from "@/i18n/config";

/** Used by Client Components on every page: shell, language switcher, error texts (common), connectivity banner (offline). */
const BASE_NAMESPACES: readonly Namespace[] = ["common", "offline"];

/** Client namespaces of the /dashboard pages (admin pages add "admin", see dashboard/admin/layout.tsx). */
export const DASHBOARD_NAMESPACES: readonly Namespace[] = ["dashboard", "account", "notifications", "timetable", "announcements"];

/**
 * Hands the messages of `namespaces` (plus common and offline) to the Client Components below it (Server Component).
 *
 * The messages given to a provider are serialized into every page it wraps, so each route group only sends the
 * namespaces its Client Components use instead of all ten. A nested provider REPLACES its parent's messages
 * (no merge): list every namespace the subtree's Client Components need, including the ones of shared
 * components rendered on the client (e.g. components/announcements/badges.tsx inside a Client Component).
 * Server Components are not concerned: they read every namespace from the request config.
 */
export async function ClientMessages({
  namespaces = [],
  children,
}: Readonly<{ namespaces?: readonly Namespace[]; children: React.ReactNode }>) {
  const messages = await getMessages();
  const picked = Object.fromEntries([...new Set([...BASE_NAMESPACES, ...namespaces])].map((namespace) => [namespace, messages[namespace]]));
  return <NextIntlClientProvider messages={picked}>{children}</NextIntlClientProvider>;
}
