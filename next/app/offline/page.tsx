import type { Metadata } from "next";
import { CalendarDays, CloudOff, House, Megaphone } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Logo from "@/components/ui/logo";
import { RetryButton } from "./retry-button";

/**
 * Public offline fallback (Module 8). The service worker precaches this page and serves it for
 * navigations that fail while offline when no cached copy of the requested page exists.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("offline.page");
  return { title: t("metaTitle"), robots: { index: false } };
}

export default async function OfflinePage() {
  const t = await getTranslations("offline.page");
  const views = [
    { href: "/dashboard/timetable", label: t("timetable"), icon: CalendarDays },
    { href: "/dashboard/announcements", label: t("announcements"), icon: Megaphone },
    { href: "/dashboard", label: t("home"), icon: House },
  ];

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-linear-to-b from-accent to-background px-6 py-8">
      <div>
        <Logo />
      </div>
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center py-12 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-brand text-brand-foreground shadow-lg shadow-primary/20">
          <CloudOff className="h-8 w-8" aria-hidden="true" />
        </span>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-foreground">{t("title")}</h1>
        <p className="mt-3 text-muted-foreground">{t("description")}</p>

        <section className="mt-8 w-full text-left">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("savedViews")}</h2>
          <ul className="mt-3 space-y-2">
            {views.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                {/* Plain links: full navigations are answered by the service worker (cached page or this one). */}
                <a
                  href={href}
                  className="flex items-center gap-3 rounded-2xl border bg-card px-4 py-3 font-medium text-card-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-primary">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </section>

        <p className="mt-6 text-sm text-muted-foreground">{t("tip")}</p>
        <div className="mt-8">
          <RetryButton label={t("retry")} />
        </div>
      </main>
    </div>
  );
}
