// Module 7 (announcements): shapes of /api/announcements (docs/phase1-contract.md, section 7).
// Types and constants only: usable from Server and Client Components.
import type { Paginated, Role } from "@/lib/types";

export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const STATUSES = ["DRAFT", "SCHEDULED", "PUBLISHED"] as const;
export type AnnouncementStatus = (typeof STATUSES)[number];

export type AudienceProgram = { id: string; name: string; code: string };
export type AudienceGroup = { id: string; name: string };

export type Audience = {
  roles: Role[];
  programs: AudienceProgram[];
  levels: number[];
  groups: AudienceGroup[];
};

/** Audience as sent to the API (ids only). */
export type AudienceInput = { roles: Role[]; programs: string[]; levels: number[]; groups: string[] };

export type Attachment = { id: string; filename: string; size: number; mimeType: string };

export type AnnouncementAuthor = { id: string; firstname: string; lastname: string; role: Role | null } | null;

export type AnnouncementStats = { recipients: number; reads: number; readRate: number };

export type Announcement = {
  id: string;
  title: string;
  /** Plain text: keep the line breaks, never render it as HTML. */
  body: string;
  priority: Priority;
  audience: Audience;
  attachments: Attachment[];
  author: AnnouncementAuthor;
  status: AnnouncementStatus;
  publishAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Recipient views only. */
  read?: boolean;
  /** Author / admin views only. */
  stats?: AnnouncementStats;
};

/** GET /api/announcements: the recipient feed. */
export type AnnouncementFeed = Paginated<Announcement> & { unreadCount: number };

/** GET /api/announcements/:id/stats */
export type AnnouncementDetailedStats = AnnouncementStats & { readsByDay: { date: string; count: number }[] };

export const TITLE_MAX_LENGTH = 200;
export const BODY_MAX_LENGTH = 10_000;
/** Attachments per announcement (contract section 7). */
export const MAX_ATTACHMENTS = 5;
/** Default MAX_UPLOAD_MB of the backend: checked in the browser before uploading. */
export const MAX_FILE_MB = 10;
export const ATTACHMENT_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".docx", ".xlsx", ".pptx", ".txt"] as const;
export const ATTACHMENT_ACCEPT = ATTACHMENT_EXTENSIONS.join(",");
/** Study levels of a group (1..5). */
export const LEVELS = [1, 2, 3, 4, 5] as const;

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export function isObjectId(value: unknown): value is string {
  return typeof value === "string" && OBJECT_ID_RE.test(value);
}

export function isPriority(value: unknown): value is Priority {
  return typeof value === "string" && (PRIORITIES as readonly string[]).includes(value);
}

export function isStatus(value: unknown): value is AnnouncementStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

/** Loose runtime check of an API answer (offline copies, failed snapshots). */
export function isAnnouncement(value: unknown): value is Announcement {
  const candidate = value as Partial<Announcement> | null;
  return !!candidate && typeof candidate.id === "string" && typeof candidate.title === "string" && typeof candidate.body === "string";
}

export function isFeed(value: unknown): value is AnnouncementFeed {
  return !!value && Array.isArray((value as Partial<AnnouncementFeed>).items);
}

export function hasAttachmentExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ATTACHMENT_EXTENSIONS.some((extension) => lower.endsWith(extension));
}
