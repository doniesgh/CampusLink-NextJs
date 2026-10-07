import { LATEST_PATH } from "@/lib/announcements/paths";
import { isFeed, type AnnouncementFeed } from "@/lib/announcements/types";
import { serverSnapshot } from "@/lib/server-api";
import type { User } from "@/lib/types";
import { LatestAnnouncementsCard } from "./latest-card";

/**
 * Dashboard widget "Latest announcements" (Server Component). The newest announcements are rendered
 * on the server, so the dashboard makes no API request from the browser when it loads; the card then
 * keeps an offline copy and refreshes on focus / reconnection.
 */
export async function LatestWidget({ user }: Readonly<{ user: User }>) {
  const snapshot = await serverSnapshot<AnnouncementFeed | null>(LATEST_PATH, null);
  return (
    <LatestAnnouncementsCard
      initialData={isFeed(snapshot.data) ? snapshot.data : null}
      renderedAt={snapshot.savedAt}
      canWrite={user.role === "ADMIN" || user.role === "TEACHER"}
    />
  );
}
