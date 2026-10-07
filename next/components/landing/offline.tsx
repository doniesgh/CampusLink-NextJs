import { CheckCheck, RefreshCw, WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";

const steps = [
  { key: "lose", icon: WifiOff },
  { key: "keep", icon: RefreshCw },
  { key: "reconnect", icon: CheckCheck },
] as const;

export default function Offline() {
  const t = useTranslations("landing.offline");

  return (
    <section
      id="offline"
      className="relative scroll-mt-20 overflow-hidden rounded-[2rem] border-b border-brand-foreground/10 bg-brand p-10 text-brand-foreground"
    >
      <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-highlight/20 blur-3xl" />
      <div className="container relative py-20 md:py-28">
        <h2 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-5xl">{t("title")}</h2>
        <p className="mt-4 max-w-2xl text-brand-muted-foreground">{t("subtitle")}</p>
        <ol className="mt-14 grid gap-6 md:grid-cols-3">
          {steps.map(({ key, icon: Icon }, i) => (
            <li key={key} className="rounded-3xl border border-brand-foreground/10 bg-brand-foreground/5 p-7 backdrop-blur">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-highlight text-highlight-foreground">
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </span>
                <span className="text-4xl font-bold text-brand-foreground/30" aria-hidden="true">{i + 1}</span>
              </div>
              <h3 className="mt-5 text-xl font-semibold">{t(`steps.${key}.title`)}</h3>
              <p className="mt-2 text-sm text-brand-muted-foreground">{t(`steps.${key}.text`)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
