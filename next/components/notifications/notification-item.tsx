"use client";

import Link from "@/components/ui/app-link";
import { Bell, CalendarClock, Megaphone } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { safeNextPath } from "@/lib/safe-next";
import type { AppNotification, NotificationType } from "@/lib/types";
import { cn } from "@/lib/utils";

const TYPE_ICONS: Record<NotificationType, typeof Bell> = {
  TIMETABLE_CHANGE: CalendarClock,
  ANNOUNCEMENT: Megaphone,
  SYSTEM: Bell,
};

/** One notification: links to its `link` (relative paths only); unread ones get a "New" pill. */
export function NotificationItem({
  notification,
  onOpen,
  compact = false,
}: {
  notification: AppNotification;
  /** Called when the user opens the notification (mark it as read). */
  onOpen?: (notification: AppNotification) => void;
  compact?: boolean;
}) {
  const t = useTranslations("notifications");
  const tCommon = useTranslations("common.states");
  const format = useFormatter();
  const Icon = TYPE_ICONS[notification.type] ?? Bell;
  const unread = !notification.readAt;
  const href = safeNextPath(notification.link);
  const date = Number.isNaN(Date.parse(notification.createdAt)) ? null : new Date(notification.createdAt);

  const content = (
    <>
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
          unread ? "bg-highlight text-highlight-foreground" : "bg-accent text-primary"
        )}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className={cn("font-semibold text-foreground", !compact && "text-base")}>{notification.title}</span>
          {unread && <Badge variant="highlight">{tCommon("new")}</Badge>}
        </span>
        {notification.body && (
          <span className={cn("mt-0.5 block whitespace-pre-line text-sm text-muted-foreground", compact && "line-clamp-2")}>
            {notification.body}
          </span>
        )}
        <span className="mt-1 block text-xs text-muted-foreground">
          {t(`types.${notification.type}`)}
          {date && (
            <>
              {" · "}
              <time dateTime={notification.createdAt}>{format.dateTime(date, "dayMonthTime")}</time>
            </>
          )}
        </span>
      </span>
    </>
  );

  const className = cn(
    "flex w-full items-start gap-3 rounded-2xl p-3 text-left transition-colors",
    unread ? "bg-accent/60" : "bg-transparent",
    href && "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  );

  if (!href) return <div className={className}>{content}</div>;
  return (
    <Link href={href} className={className} onClick={() => onOpen?.(notification)}>
      {content}
    </Link>
  );
}
