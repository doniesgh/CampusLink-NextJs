import { useFormatter, useTranslations } from "next-intl";
import { APP_TIMEZONE } from "@/lib/datetime";
import type { Announcement, AnnouncementAuthor } from "@/lib/announcements/types";

function yearIn(date: Date): string {
  return new Intl.DateTimeFormat("en", { timeZone: APP_TIMEZONE, year: "numeric" }).format(date);
}

/** "Oct 7, 10:42" this year, "Oct 7, 2025, 10:42" otherwise (campus timezone). */
export function useDateTimeLabel(): (value: string | null | undefined) => string | null {
  const format = useFormatter();
  return (value) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return format.dateTime(date, yearIn(date) === yearIn(new Date()) ? "dayMonthTime" : "dateTime");
  };
}

/** "Amira Ben Salah", or "CampusLink" when the author is unknown. */
export function useAuthorName(): (author: AnnouncementAuthor) => string {
  const t = useTranslations("announcements");
  return (author) => {
    const name = author ? `${author.firstname ?? ""} ${author.lastname ?? ""}`.trim() : "";
    return name || t("unknownAuthor");
  };
}

/** When the announcement went (or will go) out: publishedAt, else publishAt, else the last edit. */
export function referenceDate(announcement: Pick<Announcement, "publishedAt" | "publishAt" | "updatedAt" | "createdAt">): string {
  return announcement.publishedAt ?? announcement.publishAt ?? announcement.updatedAt ?? announcement.createdAt;
}
