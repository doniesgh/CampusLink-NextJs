"use client";

import Link from "@/components/ui/app-link";
import { ArrowLeft, BookOpenCheck, ExternalLink, Eye, Users } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { AnnouncementBody } from "@/components/announcements/announcement-body";
import { AttachmentList } from "@/components/announcements/attachment-list";
import { AudienceSummary } from "@/components/announcements/audience-summary";
import { PriorityBadge, StatusBadge } from "@/components/announcements/badges";
import { ManageActions } from "@/components/announcements/manage-actions";
import { ReadsChart } from "@/components/announcements/reads-chart";
import { useAuthorName, useDateTimeLabel } from "@/components/announcements/use-format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InlineFeedback, useFeedback } from "@/components/ui/feedback";
import { detailHref, manageHref } from "@/lib/announcements/paths";
import type { Announcement, AnnouncementDetailedStats } from "@/lib/announcements/types";

function StatTile({ icon: Icon, label, value, children }: { icon: typeof Users; label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-3xl border bg-card p-4 text-card-foreground sm:p-5">
      <dt className="flex items-center gap-2 text-xs text-muted-foreground sm:text-sm">
        <Icon className="hidden h-4 w-4 shrink-0 text-primary sm:block" aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{value}</dd>
      {children}
    </div>
  );
}

/** Statistics page of one announcement (author / admin). */
export function StatsView({ announcement, stats }: { announcement: Announcement; stats: AnnouncementDetailedStats | null }) {
  const t = useTranslations("announcements.stats");
  const tManage = useTranslations("announcements.manage");
  const tRoles = useTranslations("common.roles");
  const format = useFormatter();
  const authorName = useAuthorName();
  const dateLabel = useDateTimeLabel();
  const [feedback, setFeedback] = useFeedback();

  const published = announcement.status === "PUBLISHED";
  const recipients = stats?.recipients ?? announcement.stats?.recipients ?? 0;
  const reads = stats?.reads ?? announcement.stats?.reads ?? 0;
  const readRate = stats?.readRate ?? announcement.stats?.readRate ?? 0;
  const percent = Math.round(Math.min(1, Math.max(0, readRate)) * 100);
  const when =
    announcement.status === "PUBLISHED"
      ? t("publishedOn", { date: dateLabel(announcement.publishedAt) ?? "" })
      : announcement.status === "SCHEDULED"
        ? t("scheduledFor", { date: dateLabel(announcement.publishAt) ?? "" })
        : t("draftEdited", { date: dateLabel(announcement.updatedAt) ?? "" });
  const role = announcement.author?.role;

  return (
    <div className="space-y-6">
      <Link
        href={manageHref}
        className="inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {tManage("backToList")}
      </Link>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={announcement.status} />
          <PriorityBadge priority={announcement.priority} />
        </div>
        <h1 className="break-words text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{announcement.title}</h1>
        <p className="text-sm text-muted-foreground">
          {t("byline", { author: authorName(announcement.author) })}
          {role ? ` (${tRoles(role)})` : ""} · {when}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ManageActions announcement={announcement} onFeedback={setFeedback} backToList size="default" />
          {published && (
            <Button asChild variant="ghost" className="rounded-full">
              <Link href={detailHref(announcement.id)}>
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                {t("openInFeed")}
              </Link>
            </Button>
          )}
        </div>
      </header>

      <InlineFeedback feedback={feedback} />

      <section aria-labelledby="stats-heading" className="space-y-4">
        <h2 id="stats-heading" className="text-lg font-semibold text-foreground">
          {t("title")}
        </h2>
        {!published && <p className="text-sm text-muted-foreground">{t("notPublished")}</p>}
        <dl className="grid grid-cols-3 gap-3 sm:gap-4">
          <StatTile icon={Users} label={t("recipients")} value={format.number(recipients)} />
          <StatTile icon={BookOpenCheck} label={t("reads")} value={format.number(reads)} />
          <StatTile icon={Eye} label={t("readRate")} value={published ? format.number(readRate, "percent") : "—"}>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-accent"
              role="meter"
              aria-label={t("readRate")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={published ? percent : 0}
              aria-valuetext={published ? t("readRateText", { reads, recipients }) : t("notPublishedShort")}
            >
              <div className="h-full rounded-full bg-primary" style={{ width: `${published ? percent : 0}%` }} />
            </div>
          </StatTile>
        </dl>
      </section>

      {published && (
        <Card>
          <CardHeader>
            <CardTitle>{t("chart.title")}</CardTitle>
            <CardDescription>{t("chart.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            {stats ? <ReadsChart days={stats.readsByDay} /> : <p className="text-sm text-muted-foreground">{t("chart.unavailable")}</p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("audience")}</CardTitle>
        </CardHeader>
        <CardContent>
          <AudienceSummary audience={announcement.audience} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("message")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <AnnouncementBody text={announcement.body} />
          <AttachmentList announcementId={announcement.id} attachments={announcement.attachments ?? []} />
        </CardContent>
      </Card>
    </div>
  );
}
