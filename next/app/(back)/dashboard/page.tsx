import type { Metadata } from "next";
import Link from "next/link";
import { Bus, CalendarClock, CircleAlert, GraduationCap, MessagesSquare, ShieldCheck, ShoppingBag, UserRound, Users } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { LatestWidget } from "@/components/announcements/latest-widget";
import { UnreadNotificationsWidget } from "@/components/notifications/unread-widget";
import { TodayWidget } from "@/components/timetable/today-widget";
import { Badge } from "@/components/ui/badge";
import { getCurrentUser } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverSnapshot } from "@/lib/server-api";
import type { NotificationList } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("metaTitle") };
}

const upcoming = [
  { key: "carpool", icon: Bus },
  { key: "notes", icon: ShoppingBag },
  { key: "forum", icon: MessagesSquare },
  { key: "alumni", icon: GraduationCap },
] as const;

export default async function DashboardPage() {
  const [{ user, error }, t, tRoles, tStates, format] = await Promise.all([
    getCurrentUser("/dashboard"),
    getTranslations("dashboard"),
    getTranslations("common.roles"),
    getTranslations("common.states"),
    getFormatter(),
  ]);

  if (!user) {
    const errors = await getErrorFormatter();
    return (
      <div className="container py-10">
        <div role="alert" className="mx-auto flex max-w-xl items-start gap-3 rounded-3xl border border-destructive/30 bg-card p-6 text-card-foreground">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
          <div>
            <h1 className="text-lg font-semibold">{t("loadError.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{errors.message(error)}</p>
            <Link href="/dashboard" className="mt-4 inline-block text-sm font-semibold text-primary underline-offset-4 hover:underline">
              {t("loadError.retry")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Rendered on the server: the page makes no API request from the browser when it loads.
  const unreadPreview = await serverSnapshot<NotificationList | null>("/notifications?unread=true&limit=5", null);
  const memberSince = Number.isNaN(Date.parse(user.createdAt)) ? null : format.dateTime(new Date(user.createdAt), "date");
  const roleLabel = tRoles(user.role);

  return (
    <div className="container space-y-8 py-6 sm:py-10">
      <section className="relative overflow-hidden rounded-3xl bg-brand p-6 text-brand-foreground shadow-lg shadow-primary/20 sm:p-10">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-highlight/20 blur-3xl" />
        <p className="relative text-sm font-medium text-brand-muted-foreground">{t("hero.eyebrow")}</p>
        <h1 className="relative mt-1 text-3xl font-bold tracking-tight sm:text-4xl">{t("hero.welcome", { name: user.firstname })}</h1>
        <div className="relative mt-3 flex flex-wrap items-center gap-3">
          <Badge variant="highlight">{roleLabel}</Badge>
          <p className="text-brand-muted-foreground">{t("hero.signedInAs", { email: user.email })}</p>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <TodayWidget user={user} />
        <LatestWidget user={user} />
        <UnreadNotificationsWidget
          initialData={Array.isArray(unreadPreview.data?.items) ? unreadPreview.data : null}
          renderedAt={unreadPreview.savedAt}
        />
      </div>

      <section aria-labelledby="account-heading" className="rounded-3xl border bg-card p-6 text-card-foreground sm:p-8">
        <h2 id="account-heading" className="text-xl font-semibold">{t("account.title")}</h2>
        <dl className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
              <UserRound className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <dt className="text-sm text-muted-foreground">{t("account.role")}</dt>
              <dd className="font-semibold" data-role={user.role}>
                {roleLabel}
              </dd>
            </div>
          </div>
          {user.role === "STUDENT" && (
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
                <Users className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <dt className="text-sm text-muted-foreground">{t("account.group")}</dt>
                <dd className="font-semibold">
                  {user.group ? `${user.group.name} · ${user.group.program.code}` : t("account.noGroup")}
                </dd>
              </div>
            </div>
          )}
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <dt className="text-sm text-muted-foreground">{t("account.twoFactor")}</dt>
              <dd className="font-semibold">{user.twoFactorEnabled ? tStates("on") : tStates("off")}</dd>
            </div>
          </div>
          {memberSince && (
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
                <CalendarClock className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <dt className="text-sm text-muted-foreground">{t("account.memberSince")}</dt>
                <dd className="font-semibold">{memberSince}</dd>
              </div>
            </div>
          )}
        </dl>
      </section>

      <section aria-labelledby="soon-heading">
        <h2 id="soon-heading" className="text-xl font-semibold">{t("soon.title")}</h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {upcoming.map(({ key, icon: Icon }) => (
            <li key={key} className="rounded-2xl border bg-card p-5 text-card-foreground">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-highlight text-highlight-foreground">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 font-semibold">{t(`soon.${key}.title`)}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t(`soon.${key}.text`)}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
