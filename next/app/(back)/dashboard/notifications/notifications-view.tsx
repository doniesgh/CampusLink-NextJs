"use client";

import { useState } from "react";
import { BellRing, CheckCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { NotificationItem } from "@/components/notifications/notification-item";
import { UNREAD_COUNT_KEY } from "@/components/notifications/use-unread-count";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback, useFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonList } from "@/components/ui/skeleton";
import { useErrorFormatter } from "@/lib/i18n/client";
import { queueMutation } from "@/lib/offline/outbox";
import { useOfflineQuery, useQueryClient } from "@/lib/offline/query";
import type { AppNotification, NotificationList } from "@/lib/types";

const PAGE_SIZE = 20;
const pageKey = (page: number) => ["notifications", "list", page] as const;
const pagePath = (page: number) => `/notifications?page=${page}&limit=${PAGE_SIZE}`;

function markReadIn(list: NotificationList | undefined, id: string | null, readAt: string): NotificationList | undefined {
  if (!list) return list;
  return {
    ...list,
    unreadCount: id ? Math.max(0, list.unreadCount - (list.items.some((n) => n.id === id && !n.readAt) ? 1 : 0)) : 0,
    items: list.items.map((n) => (!n.readAt && (id === null || n.id === id) ? { ...n, readAt } : n)),
  };
}

/** One page of 20 notifications (each page is its own offline query). */
function NotificationPage({
  page,
  onOpen,
  initial,
}: {
  page: number;
  onOpen: (notification: AppNotification) => void;
  initial?: { data: NotificationList; renderedAt: number } | null;
}) {
  const t = useTranslations("notifications");
  const tStates = useTranslations("common.states");
  const errors = useErrorFormatter();
  const { data, isLoading, error } = useOfflineQuery<NotificationList>(pageKey(page), pagePath(page), {
    fallbackData: initial?.data,
    fallbackSavedAt: initial?.renderedAt,
    revalidateOnMount: !initial,
  });

  if (isLoading) return <SkeletonList rows={page === 1 ? 4 : 2} label={tStates("loading")} />;
  if (!data) {
    return page === 1 ? (
      <InlineFeedback feedback={{ type: "error", message: error ? `${t("loadError")} ${errors.message(error)}` : t("loadError") }} />
    ) : null;
  }
  if (page === 1 && data.items.length === 0) {
    return <EmptyState icon={BellRing} title={t("empty")} />;
  }
  return (
    <ul className="space-y-1">
      {data.items.map((notification) => (
        <li key={notification.id}>
          <NotificationItem notification={notification} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  );
}

export function NotificationsView({
  initialFirstPage,
  renderedAt,
}: {
  initialFirstPage: NotificationList | null;
  renderedAt: number;
}) {
  const t = useTranslations("notifications");
  const tActions = useTranslations("common.actions");
  const errors = useErrorFormatter();
  const queryClient = useQueryClient();
  const [pages, setPages] = useState(1);
  const [feedback, setFeedback] = useFeedback();
  const [pending, setPending] = useState(false);

  // Totals come from the first page (kept in the shared query cache).
  const initial = initialFirstPage ? { data: initialFirstPage, renderedAt } : null;
  const { data: first } = useOfflineQuery<NotificationList>(pageKey(1), pagePath(1), {
    fallbackData: initial?.data,
    fallbackSavedAt: initial?.renderedAt,
    revalidateOnMount: !initial,
  });
  const total = first?.total ?? 0;
  const unreadCount = first?.unreadCount ?? 0;

  const updateAllPages = (id: string | null) => {
    const readAt = new Date().toISOString();
    for (let page = 1; page <= pages; page += 1) {
      queryClient.setQueryData<NotificationList>(pageKey(page), (list) => markReadIn(list, id, readAt));
    }
    queryClient.setQueryData<NotificationList>(["notifications", "unread-preview"], (list) =>
      list && { ...list, items: id ? list.items.filter((n) => n.id !== id) : [], unreadCount: id ? Math.max(0, list.unreadCount - 1) : 0 }
    );
    queryClient.setQueryData<{ count: number }>(UNREAD_COUNT_KEY, (current) => ({
      count: id ? Math.max(0, (current?.count ?? 1) - 1) : 0,
    }));
  };

  const openNotification = (notification: AppNotification) => {
    if (notification.readAt) return;
    updateAllPages(notification.id);
    void queueMutation({ method: "POST", path: `/notifications/${notification.id}/read` });
  };

  const markAllRead = async () => {
    setPending(true);
    updateAllPages(null);
    const result = await queueMutation({ method: "POST", path: "/notifications/read-all" });
    setPending(false);
    if (result.status === "sent") setFeedback({ type: "success", message: t("allMarkedRead") });
    else if (result.status === "queued") setFeedback({ type: "info", message: t("queued") });
    else {
      setFeedback({ type: "error", message: errors.message(result.error) });
      queryClient.invalidate("notifications");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <Button variant="outline" className="rounded-full" onClick={markAllRead} disabled={pending || (first !== undefined && unreadCount === 0)}>
            <CheckCheck className="h-4 w-4" aria-hidden="true" />
            {t("markAllRead")}
          </Button>
        }
      />

      <InlineFeedback feedback={feedback} />

      <div className="space-y-1 rounded-3xl border bg-card p-2 sm:p-3">
        {Array.from({ length: pages }, (_, index) => (
          <NotificationPage key={index + 1} page={index + 1} onOpen={openNotification} initial={index === 0 ? initial : null} />
        ))}
      </div>

      {total > pages * PAGE_SIZE && (
        <div className="flex justify-center">
          <Button variant="outline" className="rounded-full" onClick={() => setPages((p) => p + 1)}>
            {tActions("loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}
