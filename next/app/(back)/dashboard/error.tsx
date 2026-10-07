"use client";

import Link from "@/components/ui/app-link";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Error boundary of the dashboard pages (the shell and navigation stay usable). */
export default function DashboardError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useTranslations("dashboard.error");
  return (
    <div className="container py-10">
      <div role="alert" className="mx-auto max-w-xl rounded-3xl border border-destructive/30 bg-card p-6 text-card-foreground sm:p-8">
        <TriangleAlert className="h-6 w-6 text-destructive" aria-hidden="true" />
        <h1 className="mt-3 text-xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button className="rounded-full" onClick={() => retry()}>
            {t("retry")}
          </Button>
          <Link href="/dashboard" className={cn(buttonVariants({ variant: "outline" }), "rounded-full")}>
            {t("home")}
          </Link>
        </div>
      </div>
    </div>
  );
}
