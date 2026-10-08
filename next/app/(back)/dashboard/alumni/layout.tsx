import { ClientMessages, DASHBOARD_NAMESPACES } from "@/components/i18n/client-messages";

/** Alumni pages: their Client Components also use the "alumni" messages (a nested provider replaces its parent's). */
export default function AlumniLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ClientMessages namespaces={[...DASHBOARD_NAMESPACES, "alumni"]}>{children}</ClientMessages>;
}
