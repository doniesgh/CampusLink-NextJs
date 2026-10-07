import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { serverSnapshot } from "@/lib/server-api";
import type { NotificationList } from "@/lib/types";
import { NotificationsView } from "./notifications-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notifications");
  return { title: t("metaTitle") };
}

export default async function NotificationsPage() {
  // First page rendered on the server: no API request from the browser on page load.
  const firstPage = await serverSnapshot<NotificationList | null>("/notifications?page=1&limit=20", null);
  return (
    <div className="container max-w-3xl py-6 sm:py-10">
      <NotificationsView
        initialFirstPage={Array.isArray(firstPage.data?.items) ? firstPage.data : null}
        renderedAt={firstPage.savedAt}
      />
    </div>
  );
}
