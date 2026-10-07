"use client";

import { CloudOff, RefreshCw } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useConnectivity } from "@/lib/offline/status";

/**
 * Connectivity banner (role="status", outside <main>): shown while offline, with the age of the
 * displayed data on data pages, and the number of changes waiting to sync.
 * en: "You're offline. Showing saved data." / "Last updated <time>" / "2 changes waiting to sync".
 */
export function ConnectivityBanner() {
  const t = useTranslations("offline.banner");
  const format = useFormatter();
  const { online, pending, lastUpdated } = useConnectivity();
  const visible = !online || pending > 0;

  return (
    <div role="status" aria-live="polite" className="sticky top-0 z-[60] w-full print:hidden">
      {visible && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-foreground px-4 py-2 text-center text-sm text-background">
          {!online && (
            <span className="inline-flex items-center gap-2 font-medium">
              <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t("offline")}
            </span>
          )}
          {!online && lastUpdated !== null && (
            <span>{t("lastUpdated", { time: format.dateTime(new Date(lastUpdated), "dayMonthTime") })}</span>
          )}
          {pending > 0 && (
            <span className="inline-flex items-center gap-2 rounded-full bg-highlight px-2.5 py-0.5 text-xs font-semibold text-highlight-foreground">
              <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t("pending", { count: pending })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
