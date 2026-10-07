// Query keys and API paths of the announcements module (offline cache keys start with "announcements").

export type FeedMode = "all" | "unread";

export const FEED_PAGE_SIZE = 20;
export const LATEST_LIMIT = 4;

/** ["announcements", "feed", "all", 1] -> IndexedDB key "announcements:feed:all:1". */
export const feedKey = (mode: FeedMode, page: number) => ["announcements", "feed", mode, page] as const;
export const feedPath = (mode: FeedMode, page: number) =>
  `/announcements?page=${page}&limit=${FEED_PAGE_SIZE}${mode === "unread" ? "&unread=true" : ""}`;

export const detailKey = (id: string) => ["announcements", "detail", id] as const;
export const detailPath = (id: string) => `/announcements/${encodeURIComponent(id)}`;

export const LATEST_KEY = ["announcements", "latest"] as const;
export const LATEST_PATH = `/announcements?page=1&limit=${LATEST_LIMIT}`;

/** Web pages. */
export const feedHref = "/dashboard/announcements";
export const detailHref = (id: string) => `/dashboard/announcements/${encodeURIComponent(id)}`;
export const manageHref = "/dashboard/admin/announcements";
export const newHref = `${manageHref}/new`;
export const statsHref = (id: string) => `${manageHref}/${encodeURIComponent(id)}`;
export const editHref = (id: string) => `${manageHref}/${encodeURIComponent(id)}/edit`;

/** Download link of an attachment, through the BFF (Content-Disposition: attachment). */
export const attachmentHref = (announcementId: string, attachmentId: string) =>
  `/bff/announcements/${encodeURIComponent(announcementId)}/attachments/${encodeURIComponent(attachmentId)}`;
