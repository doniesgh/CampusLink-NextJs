"use client";

import { useState } from "react";
import { CalendarPlus, Copy, Download, Link2, Loader2, RotateCcw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Feedback } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { useErrorFormatter } from "@/lib/i18n/client";
import { BffError, bffFetch, useOnlineStatus } from "@/lib/offline";
import { googleCalendarUrl } from "@/lib/timetable/range";

const LINK_PATH = "/timetable/me/calendar-link";
/** Authenticated download through the BFF (Content-Disposition: attachment). */
export const ICS_DOWNLOAD_URL = "/bff/timetable/me/calendar.ics";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export type CalendarExport = ReturnType<typeof useCalendarExport>;

/**
 * State of the calendar export: the subscription link (GET /timetable/me/calendar-link, fetched when
 * the Export menu opens), copy and reset. Outcomes go to the page's feedback (`onFeedback`).
 */
export function useCalendarExport(onFeedback: (feedback: Feedback | null) => void) {
  const t = useTranslations("timetable.export");
  const errors = useErrorFormatter();
  const online = useOnlineStatus();
  const [link, setLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showLink, setShowLink] = useState(false);

  const fail = (error: unknown) => {
    const known = error instanceof BffError ? error : new BffError(0, "NETWORK_ERROR", "Can't reach the server.");
    onFeedback({ type: "error", message: errors.message(known) });
  };

  const loadLink = async (): Promise<string | null> => {
    if (link) return link;
    setLoading(true);
    try {
      const result = await bffFetch<{ url: string }>(LINK_PATH);
      setLink(result.url);
      return result.url;
    } catch (error) {
      fail(error);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const copyLink = async () => {
    const url = await loadLink();
    if (!url) return;
    const copied = await copyText(url);
    setShowLink(true);
    onFeedback({ type: copied ? "success" : "info", message: copied ? t("copied") : t("copyManually") });
  };

  const resetLink = async () => {
    try {
      const result = await bffFetch<{ url: string }>(`${LINK_PATH}/reset`, { method: "POST" });
      setLink(result.url);
      setShowLink(true);
      onFeedback({ type: "success", message: t("resetDone") });
    } catch (error) {
      fail(error);
    }
  };

  return { online, link, loading, showLink, setShowLink, loadLink, copyLink, resetLink };
}

/** "Export" button + menu: "Copy calendar link", "Download .ics", "Add to Google Calendar". */
export function ExportMenu({ exporter }: { exporter: CalendarExport }) {
  const t = useTranslations("timetable.export");
  const { online, link, loading, loadLink, copyLink } = exporter;

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open && !link && online) void loadLink();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="rounded-full">
          <Download className="h-4 w-4" aria-hidden="true" />
          {t("button")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60">
        <DropdownMenuItem
          disabled={!online && !link}
          onSelect={() => {
            void copyLink();
          }}
        >
          <Copy aria-hidden="true" />
          {t("copyLink")}
        </DropdownMenuItem>
        <DropdownMenuItem asChild disabled={!online}>
          <a href={ICS_DOWNLOAD_URL} download="campuslink-timetable.ics">
            <Download aria-hidden="true" />
            {t("download")}
          </a>
        </DropdownMenuItem>
        {link ? (
          <DropdownMenuItem asChild>
            <a href={googleCalendarUrl(link)} target="_blank" rel="noopener noreferrer">
              <CalendarPlus aria-hidden="true" />
              {t("google")}
            </a>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>
            {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <CalendarPlus aria-hidden="true" />}
            {t("google")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The subscription link (read-only field "Calendar link") with "Reset link", shown after "Copy calendar link". */
export function CalendarLinkPanel({ exporter }: { exporter: CalendarExport }) {
  const t = useTranslations("timetable.export");
  const { online, link, showLink, setShowLink, resetLink } = exporter;
  if (!showLink || !link) return null;

  return (
    <div className="space-y-2 rounded-3xl border bg-card p-4 text-card-foreground sm:p-5">
      <label htmlFor="timetable-calendar-link" className="flex items-center gap-2 text-sm font-medium">
        <Link2 className="h-4 w-4 text-primary" aria-hidden="true" />
        {t("linkLabel")}
      </label>
      <Input
        id="timetable-calendar-link"
        readOnly
        value={link}
        aria-describedby="timetable-calendar-link-hint"
        onFocus={(event) => event.currentTarget.select()}
        className="font-mono text-xs"
      />
      <p id="timetable-calendar-link-hint" className="text-xs text-muted-foreground">
        {t("linkHint")}
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <ConfirmDialog
          trigger={
            <Button variant="outline" size="sm" className="rounded-full" disabled={!online}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              {t("reset")}
            </Button>
          }
          title={t("resetTitle")}
          description={t("resetDescription")}
          confirmLabel={t("reset")}
          onConfirm={resetLink}
        />
        <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setShowLink(false)}>
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          {t("hide")}
        </Button>
      </div>
    </div>
  );
}
