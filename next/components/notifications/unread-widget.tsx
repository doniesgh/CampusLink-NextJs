"use client";

import Link from "next/link";
import { ArrowRight, BellOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { NotificationItem } from "@/components/notifications/notification-item";
import { UNREAD_COUNT_KEY } from "@/components/notifications/use-unread-count";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonList } from "@/components/ui/skeleton";
import { queueMutation } from "@/lib/offline/outbox";
import { useOfflineQuery, useQueryClient } from "@/lib/offline/query";
import type { AppNotification, NotificationList } from "@/lib/types";

/**
 * Dashboard widget: the 5 latest unread notifications (offline-capable).
 * Starts from the server-rendered list (no request on page load); refreshes on focus/reconnect.
 */
export function UnreadNotificationsWidget({
  initialData,
  renderedAt,
}: {
  initialData?: NotificationList | null;
  renderedAt?: number;
}) {
  const t = useTranslations("dashboard.widgets.notifications");
  const tCommon = useTranslations("common.states");
  const queryClient = useQueryClient();
  const { data, isLoading, error, mutate } = useOfflineQuery<NotificationList>(
    "notifications:unread-preview",
    "/notifications?unread=true&limit=5",
    { fallbackData: initialData ?? undefined, fallbackSavedAt: renderedAt, revalidateOnMount: !initialData }
  );
  const items = data?.items ?? [];

  const markRead = (notification: AppNotification) => {
    if (notification.readAt) return;
    mutate((current) => current && { ...current, items: current.items.filter((item) => item.id !== notification.id) });
    queryClient.setQueryData<{ count: number }>(UNREAD_COUNT_KEY, (current) => ({ count: Math.max(0, (current?.count ?? 1) - 1) }));
    void queueMutation({ method: "POST", path: `/notifications/${notification.id}/read` });
  };

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {isLoading ? (
          <SkeletonList rows={2} label={tCommon("loading")} />
        ) : items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
            <BellOff className="h-5 w-5" aria-hidden="true" />
            <p>{error && !data ? t("error") : t("empty")}</p>
          </div>
        ) : (
          <ul className="space-y-1">
            {items.map((notification) => (
              <li key={notification.id}>
                <NotificationItem notification={notification} onOpen={markRead} compact />
              </li>
            ))}
          </ul>
        )}
        <Link
          href="/dashboard/notifications"
          className="mt-auto inline-flex items-center gap-1.5 self-start rounded-lg text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("viewAll")}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  );
}
