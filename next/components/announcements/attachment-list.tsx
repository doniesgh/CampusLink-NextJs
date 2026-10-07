"use client";

import { Download, FileImage, FileSpreadsheet, FileText, Paperclip, Presentation } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useOnlineStatus } from "@/lib/offline";
import { attachmentHref } from "@/lib/announcements/paths";
import type { Attachment } from "@/lib/announcements/types";

function iconFor(mimeType: string) {
  if (mimeType.startsWith("image/")) return FileImage;
  if (mimeType.includes("spreadsheet")) return FileSpreadsheet;
  if (mimeType.includes("presentation")) return Presentation;
  if (mimeType === "application/pdf" || mimeType.startsWith("text/") || mimeType.includes("word")) return FileText;
  return Paperclip;
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot + 1).toUpperCase() : "";
}

/** "120 kB" / "1.4 MB" (localised units). */
export function useFileSize(): (bytes: number) => string {
  const format = useFormatter();
  return (bytes: number) => {
    const kilobytes = bytes / 1000;
    if (kilobytes < 1000) {
      return format.number(Math.max(1, Math.round(kilobytes)), { style: "unit", unit: "kilobyte", unitDisplay: "short" });
    }
    return format.number(kilobytes / 1000, { style: "unit", unit: "megabyte", unitDisplay: "short", maximumFractionDigits: 1 });
  };
}

/**
 * Attachments as download links (accessible name = file name) through the BFF.
 * Downloads need the network: a hint replaces nothing but tells it when offline.
 */
export function AttachmentList({ announcementId, attachments }: { announcementId: string; attachments: Attachment[] }) {
  const t = useTranslations("announcements.attachments");
  const fileSize = useFileSize();
  const online = useOnlineStatus();
  if (attachments.length === 0) return null;

  return (
    <div className="space-y-3">
      <ul className="grid gap-2 sm:grid-cols-2">
        {attachments.map((file) => {
          const Icon = iconFor(file.mimeType);
          const extension = extensionOf(file.filename);
          return (
            <li key={file.id} className="relative flex items-center gap-3 rounded-2xl border bg-card p-3 transition-colors hover:bg-accent/60">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <a
                  href={attachmentHref(announcementId, file.id)}
                  download={file.filename}
                  className="block break-all text-sm font-semibold text-foreground underline-offset-4 after:absolute after:inset-0 after:rounded-2xl hover:underline focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
                >
                  {file.filename}
                </a>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {[extension, fileSize(file.size)].filter(Boolean).join(" · ")}
                </span>
              </span>
              <Download className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </li>
          );
        })}
      </ul>
      {!online && <p className="text-sm text-muted-foreground">{t("offline")}</p>}
    </div>
  );
}
