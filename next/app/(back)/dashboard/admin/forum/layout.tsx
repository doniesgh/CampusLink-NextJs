import { ClientMessages, DASHBOARD_NAMESPACES } from "@/components/i18n/client-messages";

/** Forum moderation: its Client Components use the "admin" and "forum" messages (this provider replaces its parent's). */
export default function ForumModerationLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ClientMessages namespaces={[...DASHBOARD_NAMESPACES, "admin", "forum"]}>{children}</ClientMessages>;
}
