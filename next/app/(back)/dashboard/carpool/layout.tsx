import { ClientMessages, DASHBOARD_NAMESPACES } from "@/components/i18n/client-messages";

/** Carpool pages: their Client Components also use the "carpool" messages (a nested provider replaces its parent's). */
export default function CarpoolLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ClientMessages namespaces={[...DASHBOARD_NAMESPACES, "carpool"]}>{children}</ClientMessages>;
}
