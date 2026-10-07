import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/** Full-page "not found" state of the announcement pages (the page's h1). */
export function AnnouncementNotFound({ backHref, backLabel }: { backHref: string; backLabel: string }) {
  const t = useTranslations("announcements.notFound");
  return (
    <div className="flex flex-col items-center rounded-3xl border border-dashed bg-card px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-primary">
        <SearchX className="h-6 w-6" aria-hidden="true" />
      </span>
      <h1 className="mt-4 font-heading text-xl font-semibold text-foreground">{t("title")}</h1>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{t("text")}</p>
      <Button asChild variant="outline" className="mt-5 rounded-full">
        <Link href={backHref}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {backLabel}
        </Link>
      </Button>
    </div>
  );
}
