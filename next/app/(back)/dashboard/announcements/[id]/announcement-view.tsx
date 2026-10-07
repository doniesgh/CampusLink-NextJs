"use client";

import { useEffect, useRef } from "react";
import Link from "@/components/ui/app-link";
import { ArrowLeft, BarChart3, CloudOff } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { AnnouncementBody } from "@/components/announcements/announcement-body";
import { AttachmentList } from "@/components/announcements/attachment-list";
import { PriorityBadge, StatusBadge } from "@/components/announcements/badges";
import { AnnouncementNotFound } from "@/components/announcements/not-found-state";
import { useAuthorName, useDateTimeLabel } from "@/components/announcements/use-format";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback } from "@/components/ui/feedback";
import { SkeletonList } from "@/components/ui/skeleton";
import { useErrorFormatter } from "@/lib/i18n/client";
import { useOfflineQuery, useOnlineStatus, useQueryClient } from "@/lib/offline";
import { detailKey, detailPath, feedHref, statsHref } from "@/lib/announcements/paths";
import { markAnnouncementRead } from "@/lib/announcements/read-state";
import type { Announcement } from "@/lib/announcements/types";

function BackLink() {
  const t = useTranslations("announcements.detail");
  return (
    <Link
      href={feedHref}
      className="inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {t("back")}
    </Link>
  );
}

function Byline({ announcement }: { announcement: Announcement }) {
  const t = useTranslations("announcements.detail");
  const tRoles = useTranslations("common.roles");
  const authorName = useAuthorName();
  const dateLabel = useDateTimeLabel();
  const role = announcement.author?.role;
  const when =
    announcement.status === "PUBLISHED"
      ? { key: "publishedOn" as const, value: announcement.publishedAt }
      : announcement.status === "SCHEDULED"
        ? { key: "scheduledFor" as const, value: announcement.publishAt }
        : { key: "editedOn" as const, value: announcement.updatedAt };
  const date = dateLabel(when.value);

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      <span>
        {t("by", { author: authorName(announcement.author) })}
        {role ? ` (${tRoles(role)})` : ""}
      </span>
      {date && when.value && (
        <>
          <span aria-hidden="true">·</span>
          <span>
            {t(when.key)} <time dateTime={when.value}>{date}</time>
          </span>
        </>
      )}
    </p>
  );
}

/** Author / admin box: reads so far and a link to the statistics page. */
function ManagerBox({ announcement }: { announcement: Announcement }) {
  const t = useTranslations("announcements.detail");
  const format = useFormatter();
  const stats = announcement.stats;
  if (!stats) return null;
  return (
    <aside className="flex flex-col gap-3 rounded-3xl border bg-accent/40 p-5 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-foreground">
        {announcement.status === "PUBLISHED"
          ? t("managerReads", {
              reads: stats.reads,
              recipients: stats.recipients,
              rate: format.number(stats.readRate ?? 0, "percent"),
            })
          : t("managerNotPublished")}
      </p>
      <Button asChild variant="outline" size="sm" className="rounded-full">
        <Link href={statsHref(announcement.id)}>
          <BarChart3 className="h-4 w-4" aria-hidden="true" />
          {t("viewStats")}
        </Link>
      </Button>
    </aside>
  );
}

/**
 * /dashboard/announcements/[id]: h1 = title, plain-text body with its line breaks, attachments as
 * download links. Opening it marks it as read (queued when offline). Works offline from the copy saved
 * on this device.
 */
export function AnnouncementView({ id, initial }: { id: string; initial: { data: Announcement; savedAt: number } | null }) {
  const t = useTranslations("announcements.detail");
  const tStates = useTranslations("common.states");
  const errors = useErrorFormatter();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useOfflineQuery<Announcement>(detailKey(id), detailPath(id), {
    fallbackData: initial?.data,
    fallbackSavedAt: initial?.savedAt,
    revalidateOnMount: !initial,
  });

  // Mark as read once per visit (recipients only: `read` is undefined for authors/admins outside the audience).
  const marked = useRef<string | null>(null);
  useEffect(() => {
    if (!data || data.read !== false || marked.current === data.id) return;
    marked.current = data.id;
    void markAnnouncementRead(data.id, queryClient);
  }, [data, queryClient]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <BackLink />
        <h1 className="sr-only">{t("loadingTitle")}</h1>
        <SkeletonList rows={3} label={tStates("loading")} />
      </div>
    );
  }

  if (!data) {
    if (error?.status === 404) return <AnnouncementNotFound backHref={feedHref} backLabel={t("back")} />;
    const offline = !online || error?.isNetworkError || error?.code === "OFFLINE";
    return (
      <div className="space-y-6">
        <BackLink />
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{t("loadingTitle")}</h1>
        {offline ? (
          <EmptyState icon={CloudOff} title={t("notSavedTitle")} description={t("notSavedText")} />
        ) : (
          <InlineFeedback feedback={{ type: "error", message: error ? errors.message(error) : t("loadError") }} />
        )}
      </div>
    );
  }

  const attachments = data.attachments ?? [];

  return (
    <div className="space-y-6">
      <BackLink />
      <article aria-labelledby="announcement-title" className="space-y-6">
        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <PriorityBadge priority={data.priority} />
            {data.status !== "PUBLISHED" && <StatusBadge status={data.status} />}
          </div>
          <h1 id="announcement-title" className="break-words text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {data.title}
          </h1>
          <Byline announcement={data} />
        </header>

        <div className="rounded-3xl border bg-card p-5 text-card-foreground sm:p-8">
          <AnnouncementBody text={data.body} />
        </div>

        {attachments.length > 0 && (
          <section aria-labelledby="announcement-attachments" className="space-y-3">
            <h2 id="announcement-attachments" className="text-lg font-semibold text-foreground">
              {t("attachments", { count: attachments.length })}
            </h2>
            <AttachmentList announcementId={data.id} attachments={attachments} />
          </section>
        )}

        <ManagerBox announcement={data} />
      </article>
    </div>
  );
}
