"use client";

import Link from "@/components/ui/app-link";
import { useRouter } from "next/navigation";
import { Pencil, Send, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { Feedback } from "@/components/ui/feedback";
import { useErrorFormatter } from "@/lib/i18n/client";
import { useOnlineStatus } from "@/lib/offline";
import { editHref } from "@/lib/announcements/paths";
import type { Announcement } from "@/lib/announcements/types";
import { cn } from "@/lib/utils";
import { deleteAnnouncementAction, publishAnnouncementAction } from "@/app/(back)/dashboard/admin/announcements/actions";

/**
 * "Edit", "Publish now" (drafts / scheduled, with confirmation) and "Delete" → "Confirm delete".
 * Outcomes are reported through `onFeedback` (shown in the page, dialogs are portals outside <main>).
 */
export function ManageActions({
  announcement,
  onFeedback,
  backToList = false,
  size = "sm",
  className,
}: {
  announcement: Announcement;
  onFeedback: (feedback: Feedback) => void;
  /** After a delete, go back to the management list (stats page). */
  backToList?: boolean;
  size?: "sm" | "default";
  className?: string;
}) {
  const t = useTranslations("announcements.manage");
  const tActions = useTranslations("common.actions");
  const errors = useErrorFormatter();
  const router = useRouter();
  const online = useOnlineStatus();
  const recipients = announcement.stats?.recipients ?? 0;
  const canPublish = announcement.status !== "PUBLISHED";

  const publish = async () => {
    try {
      const result = await publishAnnouncementAction(announcement.id);
      onFeedback({ type: result.ok ? "success" : "error", message: result.message ?? errors.forCode("GENERIC") });
    } catch {
      onFeedback({ type: "error", message: errors.forCode("NETWORK_ERROR") });
    }
  };

  const remove = async () => {
    try {
      const result = await deleteAnnouncementAction(announcement.id, { backToList });
      if (result.ok && result.data?.href) {
        router.push(result.data.href);
        return;
      }
      onFeedback({ type: result.ok ? "success" : "error", message: result.message ?? errors.forCode("GENERIC") });
    } catch {
      onFeedback({ type: "error", message: errors.forCode("NETWORK_ERROR") });
    }
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Button asChild variant="outline" size={size} className="rounded-full">
        <Link href={editHref(announcement.id)}>
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          {tActions("edit")}
        </Link>
      </Button>
      {canPublish && (
        <ConfirmDialog
          trigger={
            <Button variant="outline" size={size} className="rounded-full" disabled={!online}>
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              {t("publishNow")}
            </Button>
          }
          title={t("confirmPublishTitle", { title: announcement.title })}
          description={t("confirmPublishDescription", { count: recipients })}
          confirmLabel={t("publishNow")}
          destructive={false}
          onConfirm={publish}
        />
      )}
      <ConfirmDialog
        trigger={
          <Button variant="outline" size={size} className="rounded-full text-destructive hover:text-destructive" disabled={!online}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            {tActions("delete")}
          </Button>
        }
        title={t("confirmDeleteTitle", { title: announcement.title })}
        description={t("confirmDeleteDescription")}
        confirmLabel={tActions("confirmDelete")}
        onConfirm={remove}
      />
    </div>
  );
}
