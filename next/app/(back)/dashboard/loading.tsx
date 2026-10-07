import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";

/** Shown inside the app shell while a dashboard page loads (also the prefetched shell for navigations). */
export default function DashboardLoading() {
  const t = useTranslations("common.states");
  return (
    <div className="container space-y-6 py-6 sm:py-10" aria-busy="true">
      <span className="sr-only">{t("loading")}</span>
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-48 rounded-3xl" />
        <Skeleton className="h-48 rounded-3xl" />
        <Skeleton className="h-48 rounded-3xl" />
      </div>
    </div>
  );
}
