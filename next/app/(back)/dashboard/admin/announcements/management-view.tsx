"use client";

import { useEffect } from "react";
import Link from "@/components/ui/app-link";
import { PenLine, Send } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { PriorityBadge, StatusBadge } from "@/components/announcements/badges";
import { ManageActions } from "@/components/announcements/manage-actions";
import { useAuthorName, useDateTimeLabel } from "@/components/announcements/use-format";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback, useFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { manageHref, newHref, statsHref } from "@/lib/announcements/paths";
import { STATUSES, type Announcement, type AnnouncementStatus } from "@/lib/announcements/types";
import { cn } from "@/lib/utils";

export type DoneKey = "draft" | "published" | "scheduled" | "updated" | "deleted";

function StatusFilter({ status }: { status: AnnouncementStatus | "" }) {
  const t = useTranslations("announcements.manage");
  const options: { value: AnnouncementStatus | ""; label: string }[] = [
    { value: "", label: t("filters.all") },
    ...STATUSES.map((value) => ({ value, label: t(`filters.${value}`) })),
  ];
  return (
    <nav aria-label={t("filters.label")}>
      <ul className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option.value === status;
          return (
            <li key={option.value || "all"}>
              <Link
                href={option.value ? `${manageHref}?status=${option.value}` : manageHref}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background text-foreground hover:bg-accent"
                )}
              >
                {option.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ReadRateCell({ announcement }: { announcement: Announcement }) {
  const t = useTranslations("announcements.manage");
  const format = useFormatter();
  const rate = announcement.stats?.readRate ?? 0;
  if (announcement.status !== "PUBLISHED") {
    return (
      <span className="text-muted-foreground">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{t("notPublishedYet")}</span>
      </span>
    );
  }
  return (
    <div className="flex min-w-24 items-center gap-2">
      <span className="w-10 text-right font-semibold tabular-nums">{format.number(rate, "percent")}</span>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-accent" aria-hidden="true">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(Math.min(1, Math.max(0, rate)) * 100)}%` }} />
      </span>
    </div>
  );
}

function StatusCell({ announcement }: { announcement: Announcement }) {
  const t = useTranslations("announcements.manage");
  const dateLabel = useDateTimeLabel();
  const when =
    announcement.status === "PUBLISHED"
      ? dateLabel(announcement.publishedAt)
      : announcement.status === "SCHEDULED"
        ? dateLabel(announcement.publishAt)
        : dateLabel(announcement.updatedAt);
  return (
    <div className="flex flex-col items-start gap-1">
      <StatusBadge status={announcement.status} />
      {when && <span className="whitespace-nowrap text-xs text-muted-foreground">{t(`when.${announcement.status}`, { date: when })}</span>}
    </div>
  );
}

/**
 * Management list: "New announcement", status filter, table "Title", "Status", "Recipients",
 * "Read rate", row actions. Confirmations after a save arrive as ?done=... (then removed from the URL).
 */
export function ManagementView({
  items,
  total,
  status,
  isAdmin,
  loadError,
  done,
}: {
  items: Announcement[];
  total: number;
  status: AnnouncementStatus | "";
  isAdmin: boolean;
  loadError: string | null;
  done: { key: DoneKey; recipients: number | null } | null;
}) {
  const t = useTranslations("announcements");
  const tManage = useTranslations("announcements.manage");
  const tPagination = useTranslations("common.pagination");
  const format = useFormatter();
  const authorName = useAuthorName();
  const [feedback, setFeedback] = useFeedback();

  // Confirmation of the save that brought the user here (?done=...), removed from the URL right away.
  const flash = done ? { type: "success" as const, message: tManage(`done.${done.key}`, { count: done.recipients ?? 0 }), at: 0 } : null;
  const hasDone = !!done;
  useEffect(() => {
    if (!hasDone) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("done");
    url.searchParams.delete("recipients");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
  }, [hasDone]);

  return (
    <>
      <PageHeader
        title={t("managementTitle")}
        description={isAdmin ? tManage("subtitleAdmin") : tManage("subtitleTeacher")}
        actions={
          <Button asChild variant="highlight" className="rounded-full">
            <Link href={newHref}>
              <PenLine className="h-4 w-4" aria-hidden="true" />
              {tManage("new")}
            </Link>
          </Button>
        }
      />

      <StatusFilter status={status} />

      <InlineFeedback feedback={loadError ? { type: "error", message: loadError } : (feedback ?? flash)} />

      {!loadError && items.length === 0 ? (
        <EmptyState icon={Send} title={status ? tManage("emptyFiltered") : tManage("empty")} description={tManage("emptyText")} />
      ) : (
        !loadError && (
          <>
            <p className="text-sm text-muted-foreground">{tPagination("total", { count: total })}</p>
            <Table aria-label={t("managementTitle")}>
              <TableHeader>
                <TableRow>
                  <TableHead>{tManage("columns.title")}</TableHead>
                  <TableHead>{tManage("columns.status")}</TableHead>
                  <TableHead className="text-right">{tManage("columns.recipients")}</TableHead>
                  <TableHead>{tManage("columns.readRate")}</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">{tManage("columns.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id} data-announcement-id={item.id}>
                    <TableCell className="min-w-56 max-w-md">
                      <Link
                        href={statsHref(item.id)}
                        className="line-clamp-2 font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {item.title}
                      </Link>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <PriorityBadge priority={item.priority} />
                        {isAdmin && <span>{tManage("byAuthor", { author: authorName(item.author) })}</span>}
                        {item.attachments?.length > 0 && <span>{tManage("files", { count: item.attachments.length })}</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusCell announcement={item} />
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{format.number(item.stats?.recipients ?? 0)}</TableCell>
                    <TableCell>
                      <ReadRateCell announcement={item} />
                    </TableCell>
                    <TableCell>
                      <ManageActions announcement={item} onFeedback={setFeedback} className="flex-nowrap justify-end" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )
      )}
    </>
  );
}
