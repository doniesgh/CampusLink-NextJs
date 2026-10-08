import { ClientMessages, DASHBOARD_NAMESPACES } from "@/components/i18n/client-messages";

/** Bookings & resources management: its Client Components use the "bookings" messages (components/bookings/**). */
export default function AdminBookingsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ClientMessages namespaces={[...DASHBOARD_NAMESPACES, "admin", "bookings"]}>{children}</ClientMessages>;
}
