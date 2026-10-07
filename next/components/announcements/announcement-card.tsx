"use client";

import Link from "next/link";
import { Paperclip } from "lucide-react";
import { useTranslations } from "next-intl";
import { NewBadge, PriorityBadge } from "@/components/announcements/badges";
import { referenceDate, useAuthorName, useDateTimeLabel } from "@/components/announcements/use-format";
import { useOnlineStatus } from "@/lib/offline";
import { detailHref } from "@/lib/announcements/paths";
import type { Announcement } from "@/lib/announcements/types";
import { cn } from "@/lib/utils";

/** First lines of the body, on one paragraph (the card shows 2 lines at most). */
function excerptOf(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 280);
}

/**
 * One announcement of the feed: an <article> whose title links to the detail page (the whole card
 * is clickable), with the priority pill, "New" when unread, the author, the date and the files count.
 */
export function AnnouncementCard({
  announcement,
  unread,
  compact = false,
  headingLevel = "h2",
  onLinkClick,
}: {
  announcement: Announcement;
  unread: boolean;
  compact?: boolean;
  headingLevel?: "h2" | "h3";
  onLinkClick?: (event: React.MouseEvent<HTMLAnchorElement>, announcement: Announcement) => void;
}) {
  const t = useTranslations("announcements.feed");
  const authorName = useAuthorName();
  const dateLabel = useDateTimeLabel();
  const online = useOnlineStatus();
  const Heading = headingLevel;
  const date = referenceDate(announcement);
  const files = announcement.attachments?.length ?? 0;
  const urgent = announcement.priority === "URGENT";

  return (
    <article
      className={cn(
        "group relative rounded-2xl border bg-card text-card-foreground transition-colors hover:bg-accent/50 focus-within:ring-2 focus-within:ring-ring",
        compact ? "p-3" : "p-4 sm:p-5",
        unread && "border-highlight/60 bg-highlight/5",
        urgent && "border-l-4 border-l-destructive"
      )}
      data-announcement-id={announcement.id}
      data-unread={unread ? "true" : "false"}
    >
      <Heading className={cn("font-semibold leading-snug text-foreground", compact ? "text-sm" : "text-base sm:text-lg")}>
        <Link
          href={detailHref(announcement.id)}
          // Offline: no prefetch requests (they would only fail); clicks are handled by onLinkClick.
          prefetch={online ? undefined : false}
          onClick={onLinkClick ? (event) => onLinkClick(event, announcement) : undefined}
          className="rounded-sm after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none"
        >
          {announcement.title}
        </Link>
      </Heading>
      {compact ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <PriorityBadge priority={announcement.priority} />
          {unread && <NewBadge />}
          <time dateTime={date}>{dateLabel(date)}</time>
          {files > 0 && (
            <span className="inline-flex items-center gap-1">
              <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
              {t("files", { count: files })}
            </span>
          )}
        </div>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <PriorityBadge priority={announcement.priority} />
            {unread && <NewBadge />}
          </div>
          {announcement.body && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{excerptOf(announcement.body)}</p>}
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{authorName(announcement.author)}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={date}>{dateLabel(date)}</time>
            {files > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("files", { count: files })}
                </span>
              </>
            )}
          </p>
        </>
      )}
    </article>
  );
}
