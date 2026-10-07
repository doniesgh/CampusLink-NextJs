"use client";

import Link from "next/link";
import { ArrowRight, Megaphone, PenLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { AnnouncementCard } from "@/components/announcements/announcement-card";
import { useAnnouncementOpener } from "@/components/announcements/offline-reader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonList } from "@/components/ui/skeleton";
import { useOfflineQuery } from "@/lib/offline";
import { useAnnouncementPushRefresh } from "@/lib/announcements/offline";
import { feedHref, LATEST_KEY, LATEST_PATH, newHref } from "@/lib/announcements/paths";
import { isRead, useLocalReads } from "@/lib/announcements/read-state";
import type { AnnouncementFeed } from "@/lib/announcements/types";

const linkClass =
  "inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Client part of the "Latest announcements" widget (offline-capable list of the 4 newest). */
export function LatestAnnouncementsCard({
  initialData,
  renderedAt,
  canWrite,
}: {
  initialData: AnnouncementFeed | null;
  renderedAt: number;
  canWrite: boolean;
}) {
  const t = useTranslations("announcements.widget");
  const tStates = useTranslations("common.states");
  const localReads = useLocalReads();
  const { onLinkClick, reader } = useAnnouncementOpener();
  useAnnouncementPushRefresh();
  const { data, isLoading, error } = useOfflineQuery<AnnouncementFeed>(LATEST_KEY, LATEST_PATH, {
    fallbackData: initialData ?? undefined,
    fallbackSavedAt: renderedAt,
    revalidateOnMount: !initialData,
  });
  const items = Array.isArray(data?.items) ? data.items : [];
  const unread = items.filter((item) => !isRead(item, localReads)).length;

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>{t("title")}</CardTitle>
        {unread > 0 && <span className="text-xs font-semibold text-muted-foreground">{t("unread", { count: unread })}</span>}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {isLoading ? (
          <SkeletonList rows={2} label={tStates("loading")} />
        ) : items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
            <Megaphone className="h-5 w-5" aria-hidden="true" />
            <p>{error && !data ? t("error") : t("empty")}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id}>
                <AnnouncementCard announcement={item} unread={!isRead(item, localReads)} compact headingLevel="h3" onLinkClick={onLinkClick} />
              </li>
            ))}
          </ul>
        )}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-1">
          <Link href={feedHref} className={linkClass}>
            {t("viewAll")}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          {canWrite && (
            <Link href={newHref} className={linkClass}>
              <PenLine className="h-4 w-4" aria-hidden="true" />
              {t("write")}
            </Link>
          )}
        </div>
      </CardContent>
      {reader}
    </Card>
  );
}
