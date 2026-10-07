import Link from "@/components/ui/app-link";
import { cookies } from "next/headers";
import { Bell, Bus, CalendarDays, ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ClientMessages } from "@/components/i18n/client-messages";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { StaleSessionCleanup } from "@/components/offline/stale-session-cleanup";
import Logo from "@/components/ui/logo";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/session";

/**
 * Shared shell of the login, signup and password pages: brand panel + form column.
 * Without a session cookie, whatever an earlier session left on the device is removed (StaleSessionCleanup).
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("auth.layout");
  const jar = await cookies();
  const hasSession = !!(jar.get(ACCESS_COOKIE)?.value || jar.get(REFRESH_COOKIE)?.value);
  const perks = [
    { icon: CalendarDays, text: t("perks.timetable") },
    { icon: Bell, text: t("perks.changes") },
    { icon: Bus, text: t("perks.carpool") },
    { icon: ShieldCheck, text: t("perks.roles") },
  ];

  return (
    <ClientMessages namespaces={["auth"]}>
      <div className="grid min-h-screen flex-1 lg:grid-cols-2">
        {/* Brand panel */}
        <aside className="relative hidden overflow-hidden bg-brand p-12 text-brand-foreground lg:flex lg:flex-col lg:justify-between">
          <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-foreground/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-highlight/20 blur-3xl" />

          <Link href="/" className="relative font-heading text-xl font-bold tracking-tight">
            CampusLink
          </Link>

          <div className="relative max-w-md">
            <p className="font-heading text-4xl font-bold tracking-tight">{t("tagline")}</p>
            <ul className="mt-8 space-y-4">
              {perks.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-3 text-brand-muted-foreground">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-foreground/15 text-brand-foreground backdrop-blur">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative flex max-w-sm items-start gap-3 rounded-2xl border border-brand-foreground/15 bg-brand-foreground/10 p-4 text-sm backdrop-blur">
            <Bell className="mt-0.5 h-4 w-4 shrink-0 text-highlight" aria-hidden="true" />
            <p>{t("news")}</p>
          </div>
        </aside>

        {/* Form column */}
        <main className="flex flex-col bg-linear-to-b from-accent to-background px-6 py-8 sm:px-12">
          <div className="flex items-center justify-between gap-4 lg:justify-end">
            <div className="lg:hidden">
              <Logo />
            </div>
            <LanguageSwitcher hideLabel />
          </div>

          <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
            {children}
          </div>
        </main>
        {hasSession ? null : <StaleSessionCleanup />}
      </div>
    </ClientMessages>
  );
}
