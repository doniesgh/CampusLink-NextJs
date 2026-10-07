"use client";

import { useEffect, useState } from "react";
import { CheckCheck, CloudOff, Megaphone, RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { AnnouncementCard } from "@/components/announcements/announcement-card";
import { useAnnouncementOpener } from "@/components/announcements/offline-reader";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonList } from "@/components/ui/skeleton";
import { useErrorFormatter } from "@/lib/i18n/client";
import { useOfflineQuery, useOnlineStatus } from "@/lib/offline";
import { saveDetailPagesForOffline, useAnnouncementPushRefresh } from "@/lib/announcements/offline";
import { FEED_PAGE_SIZE, feedKey, feedPath, type FeedMode } from "@/lib/announcements/paths";
import { isRead, useLocalReads } from "@/lib/announcements/read-state";
import type { Announcement, AnnouncementFeed } from "@/lib/announcements/types";

type LinkClick = (event: React.MouseEvent<HTMLAnchorElement>, announcement: Announcement) => void;
type Initial = { data: AnnouncementFeed; savedAt: number } | null;

/** Cards of one feed page (each page is its own offline query). In "unread" mode, reads made on this device are hidden. */
function FeedItems({
  items,
  mode,
  localReads,
  onLinkClick,
}: {
  items: Announcement[];
  mode: FeedMode;
  localReads: ReadonlySet<string>;
  onLinkClick: LinkClick;
}) {
  return (
    <>
      {items
        .filter((item) => mode === "all" || !isRead(item, localReads))
        .map((item) => (
          <li key={item.id}>
            <AnnouncementCard announcement={item} unread={!isRead(item, localReads)} onLinkClick={onLinkClick} />
          </li>
        ))}
    </>
  );
}

function NextFeedPage({
  mode,
  page,
  localReads,
  onLinkClick,
}: {
  mode: FeedMode;
  page: number;
  localReads: ReadonlySet<string>;
  onLinkClick: LinkClick;
}) {
  const t = useTranslations("announcements.feed");
  const tStates = useTranslations("common.states");
  const { data, isLoading } = useOfflineQuery<AnnouncementFeed>(feedKey(mode, page), feedPath(mode, page));
  if (isLoading) {
    return (
      <li>
        <SkeletonList rows={2} label={tStates("loading")} />
      </li>
    );
  }
  if (!data || !Array.isArray(data.items)) {
    return <li className="px-1 text-sm text-muted-foreground">{t("pageError")}</li>;
  }
  return <FeedItems items={data.items} mode={mode} localReads={localReads} onLinkClick={onLinkClick} />;
}

/** The feed in one mode ("all" or "unread"): remounted when the mode changes. */
function FeedList({ mode, initial, onLinkClick }: { mode: FeedMode; initial: Initial; onLinkClick: LinkClick }) {
  const t = useTranslations("announcements.feed");
  const tStates = useTranslations("common.states");
  const tActions = useTranslations("common.actions");
  const errors = useErrorFormatter();
  const online = useOnlineStatus();
  const localReads = useLocalReads();
  const [pages, setPages] = useState(1);

  const first = useOfflineQuery<AnnouncementFeed>(feedKey(mode, 1), feedPath(mode, 1), {
    fallbackData: initial?.data,
    fallbackSavedAt: initial?.savedAt,
    revalidateOnMount: !initial,
  });
  // "Unread only" never loaded on this device: filter the saved full list instead (offline).
  const fallBackToAll = mode === "unread" && !first.data && !first.isLoading;
  const savedAll = useOfflineQuery<AnnouncementFeed>(feedKey("all", 1), fallBackToAll ? feedPath("all", 1) : null, {
    revalidateOnMount: false,
  });
  const feed = first.data ?? (fallBackToAll ? savedAll.data : undefined);
  const items = Array.isArray(feed?.items) ? feed.items : [];

  // Detail pages of the newest announcements are saved for offline reading (service worker).
  const ids = items.map((item) => item.id).join(",");
  useEffect(() => {
    if (!online || !ids) return;
    return saveDetailPagesForOffline(ids.split(","));
  }, [online, ids]);

  if (first.isLoading || (fallBackToAll && savedAll.isLoading)) {
    return <SkeletonList rows={4} label={tStates("loading")} />;
  }

  if (!feed) {
    if (!online || first.error?.isNetworkError || first.error?.code === "OFFLINE") {
      return <EmptyState icon={CloudOff} title={t("notSavedTitle")} description={t("notSavedText")} />;
    }
    return (
      <InlineFeedback feedback={{ type: "error", message: first.error ? `${t("loadError")} ${errors.message(first.error)}` : t("loadError") }}>
        <Button variant="outline" size="sm" className="mt-2 rounded-full" onClick={() => void first.refresh()}>
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          {tActions("tryAgain")}
        </Button>
      </InlineFeedback>
    );
  }

  const readHere = items.filter((item) => item.read === false && localReads.has(item.id)).length;
  const unreadCount = Math.max(0, (feed.unreadCount ?? 0) - readHere);
  const visible = items.filter((item) => mode === "all" || !isRead(item, localReads));
  const total = feed.total ?? items.length;

  if (visible.length === 0 && (mode === "unread" || total === 0)) {
    return mode === "unread" ? (
      <EmptyState icon={CheckCheck} title={t("allCaughtUp")} description={t("noUnread")} />
    ) : (
      <EmptyState icon={Megaphone} title={t("empty")} description={t("emptyText")} />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("unreadSummary", { count: unreadCount })}</p>
      <ul className="space-y-3">
        <FeedItems items={items} mode={mode} localReads={localReads} onLinkClick={onLinkClick} />
        {Array.from({ length: pages - 1 }, (_, index) => (
          <NextFeedPage key={index + 2} mode={mode} page={index + 2} localReads={localReads} onLinkClick={onLinkClick} />
        ))}
      </ul>
      {total > pages * FEED_PAGE_SIZE && (
        <div className="flex justify-center">
          <Button variant="outline" className="rounded-full" onClick={() => setPages((count) => count + 1)}>
            {tActions("loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * /dashboard/announcements: the feed of the announcements the user receives, newest first.
 * Works offline (IndexedDB copy, "Last updated" in the banner); "Unread only" is kept in the URL
 * (?unread=1) without a server round trip.
 */
export function FeedView({ initial }: { initial: { mode: FeedMode; data: AnnouncementFeed | null; savedAt: number | null } }) {
  const t = useTranslations("announcements.feed");
  const [mode, setMode] = useState<FeedMode>(initial.mode);
  const { onLinkClick, reader } = useAnnouncementOpener();
  useAnnouncementPushRefresh();

  const onUnreadChange = (checked: boolean) => {
    setMode(checked ? "unread" : "all");
    const url = new URL(window.location.href);
    if (checked) url.searchParams.set("unread", "1");
    else url.searchParams.delete("unread");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
  };

  const initialForMode: Initial =
    initial.mode === mode && initial.data && initial.savedAt !== null ? { data: initial.data, savedAt: initial.savedAt } : null;

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <div className="flex items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3">
        <CheckboxField
          id="announcements-unread-only"
          label={t("unreadOnly")}
          checked={mode === "unread"}
          onChange={(event) => onUnreadChange(event.target.checked)}
        />
      </div>
      <FeedList key={mode} mode={mode} initial={initialForMode} onLinkClick={onLinkClick} />
      {reader}
    </div>
  );
}
