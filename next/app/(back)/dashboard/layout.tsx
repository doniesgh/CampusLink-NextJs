import { DataLayerProvider } from "@/components/offline/data-layer-provider";
import { AppShell } from "@/components/shell/app-shell";
import { getCurrentUser } from "@/lib/dal";
import { serverSnapshot } from "@/lib/server-api";

/**
 * Shell of every /dashboard page (protected by proxy.ts): navigation by role, unread badge,
 * language switcher, logout, and the offline data layer scoped to the signed-in user.
 */
export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { user } = await getCurrentUser();

  if (!user) {
    // Backend unreachable: the page itself explains the problem.
    return (
      <AppShell user={null} unreadCount={0}>
        {children}
      </AppShell>
    );
  }

  const unread = await serverSnapshot<{ count?: number } | null>("/notifications/unread-count", null);

  return (
    <DataLayerProvider userId={user.id}>
      <AppShell
        user={{ firstname: user.firstname, lastname: user.lastname, email: user.email, role: user.role }}
        unreadCount={typeof unread.data?.count === "number" ? unread.data.count : 0}
        renderedAt={unread.savedAt}
      >
        {children}
      </AppShell>
    </DataLayerProvider>
  );
}
