import { cache } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AnnouncementNotFound } from "@/components/announcements/not-found-state";
import { toApiError, type ApiError } from "@/lib/api";
import { detailPath, feedHref } from "@/lib/announcements/paths";
import { isAnnouncement, isObjectId, type Announcement } from "@/lib/announcements/types";
import { serverApi } from "@/lib/server-api";
import { AnnouncementView } from "./announcement-view";

type Params = Promise<{ id: string }>;
type Loaded = { data: Announcement; savedAt: number; error?: undefined } | { data?: undefined; error: ApiError };

// One backend call per request, shared by generateMetadata and the page.
const loadAnnouncement = cache(async (id: string): Promise<Loaded> => {
  try {
    const data = await serverApi<Announcement>(detailPath(id));
    if (!isAnnouncement(data)) return { error: toApiError(new Error("Unexpected answer")) };
    return { data, savedAt: Date.now() };
  } catch (e) {
    return { error: toApiError(e) };
  }
});

const isMissing = (error: ApiError) => error.status === 404 || error.status === 400 || error.status === 403;

export async function generateMetadata({ params }: Readonly<{ params: Params }>): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("announcements");
  if (!isObjectId(id)) return { title: t("detailTitle") };
  const loaded = await loadAnnouncement(id);
  return { title: loaded.data?.title ?? t("detailTitle") };
}

export default async function AnnouncementPage({ params }: Readonly<{ params: Params }>) {
  const { id } = await params;
  const t = await getTranslations("announcements.detail");

  const loaded = isObjectId(id) ? await loadAnnouncement(id) : null;
  if (!loaded || (loaded.error && isMissing(loaded.error))) {
    return (
      <div className="container max-w-3xl py-6 sm:py-10">
        <AnnouncementNotFound backHref={feedHref} backLabel={t("back")} />
      </div>
    );
  }

  // Backend unreachable: the browser shows the copy saved on this device, if any.
  return (
    <div className="container max-w-3xl py-6 sm:py-10">
      <AnnouncementView id={id} initial={loaded.data ? { data: loaded.data, savedAt: loaded.savedAt } : null} />
    </div>
  );
}
