import { ClientMessages, DASHBOARD_NAMESPACES } from "@/components/i18n/client-messages";

/** Forum pages: their Client Components also use the "forum" messages (a nested provider replaces its parent's). */
export default function ForumLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ClientMessages namespaces={[...DASHBOARD_NAMESPACES, "forum"]}>{children}</ClientMessages>;
}
