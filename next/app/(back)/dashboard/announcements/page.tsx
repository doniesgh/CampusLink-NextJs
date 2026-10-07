import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { feedPath, type FeedMode } from "@/lib/announcements/paths";
import { isFeed, type AnnouncementFeed } from "@/lib/announcements/types";
import { serverSnapshot } from "@/lib/server-api";
import { FeedView } from "./feed-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("announcements");
  return { title: t("metaTitle") };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

export default async function AnnouncementsPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const unread = first((await searchParams).unread);
  const mode: FeedMode = unread === "1" || unread === "true" ? "unread" : "all";
  // First page rendered on the server: no API request from the browser when the page loads.
  const snapshot = await serverSnapshot<AnnouncementFeed | null>(feedPath(mode, 1), null);

  return (
    <div className="container max-w-3xl py-6 sm:py-10">
      <FeedView initial={isFeed(snapshot.data) ? { mode, data: snapshot.data, savedAt: snapshot.savedAt } : { mode, data: null, savedAt: null }} />
    </div>
  );
}
