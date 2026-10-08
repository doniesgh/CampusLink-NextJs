import { ClientMessages, DASHBOARD_NAMESPACES } from "@/components/i18n/client-messages";

/** Marketplace pages: their Client Components also use the "marketplace" messages (a nested provider replaces its parent's). */
export default function MarketplaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ClientMessages namespaces={[...DASHBOARD_NAMESPACES, "marketplace"]}>{children}</ClientMessages>;
}
