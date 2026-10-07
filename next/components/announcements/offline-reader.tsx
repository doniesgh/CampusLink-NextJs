"use client";

import { useState } from "react";
import { CloudOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { AnnouncementBody } from "@/components/announcements/announcement-body";
import { AttachmentList } from "@/components/announcements/attachment-list";
import { PriorityBadge } from "@/components/announcements/badges";
import { referenceDate, useAuthorName, useDateTimeLabel } from "@/components/announcements/use-format";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useOnlineStatus, useQueryClient } from "@/lib/offline";
import { isPageSaved, openPageFully } from "@/lib/announcements/offline";
import { detailHref } from "@/lib/announcements/paths";
import { markAnnouncementRead } from "@/lib/announcements/read-state";
import type { Announcement } from "@/lib/announcements/types";

/** Reads an announcement saved on this device, in a dialog (offline, when its page was never saved). */
function OfflineReader({ announcement, onClose }: { announcement: Announcement | null; onClose: () => void }) {
  const t = useTranslations("announcements.offlineReader");
  const authorName = useAuthorName();
  const dateLabel = useDateTimeLabel();
  const date = announcement ? referenceDate(announcement) : null;

  return (
    <Dialog open={announcement !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        {announcement && (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2">
                <PriorityBadge priority={announcement.priority} />
              </div>
              <DialogTitle className="text-2xl">{announcement.title}</DialogTitle>
              <DialogDescription className="flex items-center gap-1.5">
                <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t("savedCopy")}
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {t("byline", { author: authorName(announcement.author), date: dateLabel(date) ?? "" })}
            </p>
            <AnnouncementBody text={announcement.body} />
            <AttachmentList announcementId={announcement.id} attachments={announcement.attachments ?? []} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Link behaviour of announcement lists. Online: normal client-side navigation. Offline: the saved
 * page is opened with a full page load (served by the service worker), or, when this page was never
 * saved, the saved announcement opens in a dialog and is marked as read (queued for sync).
 *
 *   const { onLinkClick, reader } = useAnnouncementOpener();
 *   <AnnouncementCard onLinkClick={onLinkClick} … />  {reader}
 */
export function useAnnouncementOpener() {
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const [reading, setReading] = useState<Announcement | null>(null);

  const onLinkClick = (event: React.MouseEvent<HTMLAnchorElement>, announcement: Announcement) => {
    if (online || event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const href = detailHref(announcement.id);
    void isPageSaved(href).then((saved) => {
      if (saved) {
        openPageFully(href);
        return;
      }
      setReading(announcement);
      if (announcement.read === false) void markAnnouncementRead(announcement.id, queryClient);
    });
  };

  return { onLinkClick, reader: <OfflineReader announcement={reading} onClose={() => setReading(null)} /> };
}
