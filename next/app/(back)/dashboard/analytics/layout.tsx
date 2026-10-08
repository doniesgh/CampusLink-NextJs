import { ClientMessages, DASHBOARD_NAMESPACES } from "@/components/i18n/client-messages";

/** "My progress" (Module 9): its Client Components also use the "analytics" messages. */
export default function AnalyticsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ClientMessages namespaces={[...DASHBOARD_NAMESPACES, "analytics"]}>{children}</ClientMessages>;
}
