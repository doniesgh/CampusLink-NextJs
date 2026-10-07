import Link from "next/link";
import { Award, Bell, Bus, CalendarDays, Smartphone, WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Hero() {
  const t = useTranslations("landing.hero");

  const classes = [
    { time: "08:30", name: t("mock.algorithms"), room: "B12" },
    { time: "10:15", name: t("mock.databases"), room: "A04", was: "B12" },
    { time: "14:00", name: t("mock.english"), room: "C02" },
  ];

  const stats = [
    ["10", t("stats.modules")],
    ["4", t("stats.roles")],
    ["100%", t("stats.offline")],
  ];

  return (
    <section className="relative overflow-hidden rounded-[2rem] bg-linear-to-b from-accent via-background to-background p-10">
      <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute -left-32 top-64 h-72 w-72 rounded-full bg-highlight/15 blur-3xl" />

      <div className="container relative grid items-center gap-16 py-16 md:grid-cols-2 md:py-28">
        <div className="max-w-xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-background/70 px-3 py-1 text-sm font-medium text-primary backdrop-blur">
            <Smartphone className="h-4 w-4" aria-hidden="true" />
            {t("badge")}
          </span>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-6xl">{t("title")}</h1>
          <p className="mt-5 text-lg text-muted-foreground">{t("subtitle")}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/signup"
              className={cn(
                buttonVariants({ variant: "highlight", size: "lg" }),
                "rounded-full px-7 shadow-lg shadow-highlight/30"
              )}
            >
              {t("cta")}
            </Link>
            <Link
              href="/#modules"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "rounded-full border-primary/30 px-7 text-primary"
              )}
            >
              {t("secondary")}
            </Link>
          </div>
          <dl className="mt-12 flex gap-10">
            {stats.map(([n, l]) => (
              <div key={l}>
                <dt className="text-3xl font-bold text-primary">{n}</dt>
                <dd className="text-sm text-muted-foreground">{l}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="relative mx-auto w-full max-w-sm" aria-hidden="true">
          <div className="rounded-[2rem] border-8 border-brand bg-card p-5 text-card-foreground shadow-2xl shadow-primary/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold">
                <CalendarDays className="h-5 w-5 text-primary" />
                {t("mock.today")}
              </div>
              <span className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                <WifiOff className="h-3 w-3" />
                {t("mock.offline")}
              </span>
            </div>
            <ul className="mt-4 space-y-2">
              {classes.map((c) => (
                <li
                  key={c.time}
                  className={`flex items-center gap-4 rounded-xl p-3 ${c.was ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                >
                  <span className="w-11 text-sm tabular-nums opacity-80">{c.time}</span>
                  <span className="flex-1 font-medium">{c.name}</span>
                  <span className="text-right text-sm font-semibold">
                    {c.room}
                    {c.was && <span className="block text-xs font-normal line-through opacity-80">{c.was}</span>}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-primary/20 bg-accent p-3 text-sm text-accent-foreground">
              <Bell className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              {t("mock.moved")}
            </div>
          </div>

          <div className="absolute -left-4 top-24 hidden items-center gap-3 rounded-2xl border bg-card p-3 text-card-foreground shadow-xl sm:flex md:-left-12">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-primary">
              <Bus className="h-5 w-5" />
            </span>
            <span className="text-sm font-medium">{t("mock.rides")}</span>
          </div>
          <div className="absolute -right-4 bottom-16 hidden items-center gap-3 rounded-2xl border bg-card p-3 text-card-foreground shadow-xl sm:flex md:-right-10">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-highlight text-highlight-foreground">
              <Award className="h-5 w-5" />
            </span>
            <span className="text-sm font-medium">{t("mock.badge")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
