import { ClientMessages, DASHBOARD_NAMESPACES } from "@/components/i18n/client-messages";

/** Marketplace moderation: its Client Components use the "admin" and "marketplace" messages (this provider replaces its parent's). */
export default function MarketplaceModerationLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ClientMessages namespaces={[...DASHBOARD_NAMESPACES, "admin", "marketplace"]}>{children}</ClientMessages>;
}
