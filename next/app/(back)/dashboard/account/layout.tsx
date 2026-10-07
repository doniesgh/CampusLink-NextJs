import { ClientMessages, DASHBOARD_NAMESPACES } from "@/components/i18n/client-messages";

/** The account page reuses the password field of the auth pages (components/auth/password-input.tsx: "auth" messages). */
export default function AccountLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ClientMessages namespaces={[...DASHBOARD_NAMESPACES, "auth"]}>{children}</ClientMessages>;
}
