import {
  BarChart3, Bus, CalendarClock, DoorOpen, GraduationCap,
  Megaphone, MessagesSquare, ShieldCheck, ShoppingBag, WifiOff,
} from "lucide-react";
import { useTranslations } from "next-intl";

const modules = [
  { key: "timetable", icon: CalendarClock, span: "md:col-span-4", featured: true },
  { key: "rooms", icon: DoorOpen, span: "md:col-span-2" },
  { key: "carpool", icon: Bus, span: "md:col-span-2" },
  { key: "notes", icon: ShoppingBag, span: "md:col-span-2" },
  { key: "forum", icon: MessagesSquare, span: "md:col-span-2" },
  { key: "alumni", icon: GraduationCap, span: "md:col-span-3" },
  { key: "progress", icon: BarChart3, span: "md:col-span-3", bars: true },
  { key: "announcements", icon: Megaphone, span: "md:col-span-2" },
  { key: "offline", icon: WifiOff, span: "md:col-span-2" },
  { key: "auth", icon: ShieldCheck, span: "md:col-span-2" },
] as const;

export default function Modules() {
  const t = useTranslations("landing.modules");

  return (
    <section id="modules" className="container scroll-mt-20 py-20 md:py-28">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-5xl">{t("title")}</h2>
        <p className="mt-4 text-muted-foreground">{t("subtitle")}</p>
      </div>

      <ul className="mt-14 grid gap-4 md:grid-cols-6">
        {modules.map((module) => {
          const { key, icon: Icon, span } = module;
          const featured = "featured" in module && module.featured;
          const bars = "bars" in module && module.bars;
          return (
            <li
              key={key}
              className={`${span} rounded-3xl border p-7 transition hover:-translate-y-1 hover:shadow-xl motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
                featured
                  ? "border-transparent bg-brand text-brand-foreground shadow-lg shadow-primary/30"
                  : "bg-card text-card-foreground hover:border-primary/40 hover:shadow-primary/10"
              }`}
            >
              <span
                className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
                  featured ? "bg-highlight text-highlight-foreground" : "bg-accent text-primary"
                }`}
              >
                <Icon className="h-6 w-6" aria-hidden="true" />
              </span>
              <h3 className="mt-5 text-xl font-semibold">{t(`items.${key}.title`)}</h3>
              <p className={`mt-2 text-sm ${featured ? "text-brand-muted-foreground" : "text-muted-foreground"}`}>
                {t(`items.${key}.text`)}
              </p>
              {bars && (
                <div className="mt-6 flex h-16 items-end gap-2" aria-hidden="true">
                  {[40, 65, 50, 80, 95].map((h, i) => (
                    <span key={i} style={{ height: `${h}%` }} className="w-full rounded-t-md bg-linear-to-t from-primary to-primary/50" />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
