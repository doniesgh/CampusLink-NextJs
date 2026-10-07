import { ClientMessages, DASHBOARD_NAMESPACES } from "@/components/i18n/client-messages";

/** Management pages (role checks are done by each page): their Client Components also use the "admin" messages. */
export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ClientMessages namespaces={[...DASHBOARD_NAMESPACES, "admin"]}>{children}</ClientMessages>;
}
