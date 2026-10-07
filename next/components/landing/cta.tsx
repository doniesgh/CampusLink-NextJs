import Link from "next/link";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Cta() {
  const t = useTranslations("landing.cta");

  return (
    <section className="container py-20 md:py-28 p-10">
      <div className="relative overflow-hidden rounded-[2rem] bg-brand px-6 py-16 text-center text-brand-foreground shadow-2xl shadow-primary/30 sm:px-12">
        <div className="pointer-events-none absolute -left-16 -top-16 h-64 w-64 rounded-full bg-brand-foreground/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-20 -right-10 h-72 w-72 rounded-full bg-highlight/20 blur-3xl" />
        <h2 className="relative mx-auto max-w-2xl text-3xl font-bold tracking-tight sm:text-5xl">{t("title")}</h2>
        <p className="relative mx-auto mt-4 max-w-xl text-brand-muted-foreground">{t("subtitle")}</p>
        <div className="relative mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/signup"
            className={cn(buttonVariants({ variant: "highlight", size: "lg" }), "rounded-full px-7")}
          >
            {t("primary")}
          </Link>
          <Link
            href="/login"
            className={cn(
              buttonVariants({ variant: "ghost", size: "lg" }),
              "rounded-full px-7 text-brand-foreground hover:bg-brand-foreground/10 hover:text-brand-foreground"
            )}
          >
            {t("secondary")}
          </Link>
        </div>
      </div>
    </section>
  );
}
