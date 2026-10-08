import { ClientMessages, DASHBOARD_NAMESPACES } from "@/components/i18n/client-messages";

/** The bookings page's Client Components use the "bookings" messages (components/bookings/**). */
export default function BookingsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ClientMessages namespaces={[...DASHBOARD_NAMESPACES, "bookings"]}>{children}</ClientMessages>;
}
