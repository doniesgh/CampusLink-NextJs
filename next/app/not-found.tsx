import Link from "next/link";
import { Compass } from "lucide-react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import Logo from "@/components/ui/logo";
import { cn } from "@/lib/utils";

export default function NotFound() {
  const t = useTranslations("dashboard.notFound");
  return (
    <div className="flex min-h-screen flex-1 flex-col bg-linear-to-b from-accent to-background px-6 py-8">
      <div>
        <Logo />
      </div>
      <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-3xl bg-accent text-primary">
          <Compass className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-3xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("description")}</p>
        <Link href="/" className={cn(buttonVariants({ variant: "default", size: "lg" }), "mt-8 rounded-full")}>
          {t("home")}
        </Link>
      </main>
    </div>
  );
}
