import { ClientMessages, DASHBOARD_NAMESPACES } from "@/components/i18n/client-messages";

/** Student follow-up (Module 9, ADMIN): Client Components use the "admin" and "analytics" messages. */
export default function FollowUpLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ClientMessages namespaces={[...DASHBOARD_NAMESPACES, "admin", "analytics"]}>{children}</ClientMessages>;
}
