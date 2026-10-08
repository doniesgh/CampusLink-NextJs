// Module 6 (alumni directory and network): shapes of /api/alumni (docs/phase3-contract.md section 4,
// backend/docs/alumni.md). Types and constants only: usable from Server and Client Components.
import type { Paginated, ProgramRef } from "@/lib/types";

export const VISIBILITIES = ["PRIVATE", "CAMPUS"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** `{ id, firstname, lastname }`: never an e-mail address. */
export type AlumniUser = { id: string; firstname: string; lastname: string };

/** GET /api/alumni/me, directory items, GET /api/alumni/:id. Optional texts are null when empty. */
export type AlumniProfile = {
  /** null until the alumni saved their profile once (GET /me). */
  id: string | null;
  user: AlumniUser;
  program: ProgramRef | null;
  /** Graduation year. */
  promotion: number | null;
  headline: string | null;
  /** Plain text (line breaks kept): never rendered as HTML. */
  bio: string | null;
  skills: string[];
  company: string | null;
  jobTitle: string | null;
  sector: string | null;
  city: string | null;
  linkedinUrl: string | null;
  mentoringAvailable: boolean;
  mentoringTopics: string[];
  visibility: Visibility;
  consentAt: string | null;
  updatedAt: string | null;
};

export const MENTORING_STATUSES = ["PENDING", "ACCEPTED", "DECLINED", "CLOSED"] as const;
export type MentoringStatus = (typeof MENTORING_STATUSES)[number];
export type MentoringRole = "mentor" | "mentee";

/** The viewing student's request to this alumni (their open one, else their latest one); null otherwise. */
export type MyRequest = { id: string; status: MentoringStatus } | null;

/** GET /api/alumni/:id (`:id` = profile id or the alumni's user id). */
export type ProfileDetail = AlumniProfile & { id: string; myRequest?: MyRequest };

/** ADMIN support list: `listed` = CAMPUS + consent + the account is still an ALUMNI. */
export type AdminProfile = AlumniProfile & { id: string; listed: boolean };

export type DirectoryList = Paginated<AlumniProfile>;
export type AdminProfileList = Paginated<AdminProfile>;

export type FacetValue<T> = { value: T; count: number };

/** GET /api/alumni/facets: filter values of the directory, with counts. */
export type Facets = {
  total: number;
  mentoringAvailable: number;
  programs: (ProgramRef & { count: number })[];
  promotions: FacetValue<number>[];
  sectors: FacetValue<string>[];
  skills: FacetValue<string>[];
};

export type ClosedBy = "MENTOR" | "MENTEE" | "SYSTEM";

export type MentoringRequest = {
  id: string;
  /** null once the alumni erased their data. `profileId` is null when the viewer may not open the profile. */
  mentor: (AlumniUser & { profileId: string | null }) | null;
  /** null once the student's side was erased. */
  mentee: AlumniUser | null;
  topic: string;
  /** Plain text; null once removed by an erasure. */
  message: string | null;
  reply: string | null;
  status: MentoringStatus;
  /** Both e-mails, only for the two participants and only while the request is ACCEPTED. */
  contact: { mentorEmail: string | null; menteeEmail: string | null } | null;
  createdAt: string;
  updatedAt: string;
  respondedAt: string | null;
  closedAt: string | null;
  closedBy: ClosedBy | null;
};

/** GET /api/alumni/mentoring: own requests of one side, newest first. */
export type MentoringList = Paginated<MentoringRequest> & { role: MentoringRole; pendingCount: number };

export const POST_TYPES = ["NEW_JOB", "ACHIEVEMENT", "OPPORTUNITY", "EVENT", "OTHER"] as const;
export type PostType = (typeof POST_TYPES)[number];

/** `profileId` and `headline` only when the viewer may open the author's profile. */
export type PostAuthor = (AlumniUser & { profileId: string | null; headline: string | null }) | null;

export type AlumniPost = {
  id: string;
  type: PostType;
  /** Plain text (line breaks kept): never rendered as HTML. */
  body: string;
  /** https:// URL or null. */
  link: string | null;
  author: PostAuthor;
  /** Hidden posts are only returned to ADMINs and their author. */
  hidden: boolean;
  hiddenAt?: string | null;
  hiddenReason?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PostList = Paginated<AlumniPost>;

// Limits of the backend (models/alumni*Model.js, models/mentoringRequestModel.js), checked in the browser first.
export const PROMOTION_MIN = 1950;
export const HEADLINE_MAX_LENGTH = 120;
export const BIO_MAX_LENGTH = 2000;
export const COMPANY_MAX_LENGTH = 120;
export const JOB_TITLE_MAX_LENGTH = 120;
export const SECTOR_MAX_LENGTH = 80;
export const CITY_MAX_LENGTH = 80;
export const LINKEDIN_URL_MAX_LENGTH = 300;
export const MAX_SKILLS = 20;
export const SKILL_MAX_LENGTH = 40;
export const MAX_MENTORING_TOPICS = 10;
export const MENTORING_TOPIC_MIN_LENGTH = 2;
export const MENTORING_TOPIC_MAX_LENGTH = 60;
export const TOPIC_MIN_LENGTH = 2;
export const TOPIC_MAX_LENGTH = 120;
export const MESSAGE_MIN_LENGTH = 20;
export const MESSAGE_MAX_LENGTH = 1000;
export const REPLY_MAX_LENGTH = 1000;
/** PENDING requests a student may have at the same time. */
export const MAX_PENDING_PER_STUDENT = 3;
export const POST_BODY_MIN_LENGTH = 10;
export const POST_BODY_MAX_LENGTH = 2000;
export const POST_LINK_MAX_LENGTH = 500;
export const HIDE_REASON_MAX_LENGTH = 500;
export const SEARCH_MAX_LENGTH = 100;

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export function isObjectId(value: unknown): value is string {
  return typeof value === "string" && OBJECT_ID_RE.test(value);
}

export function isPostType(value: unknown): value is PostType {
  return typeof value === "string" && (POST_TYPES as readonly string[]).includes(value);
}

export function isMentoringStatus(value: unknown): value is MentoringStatus {
  return typeof value === "string" && (MENTORING_STATUSES as readonly string[]).includes(value);
}

/** Loose runtime checks of API answers (offline copies, failed snapshots). */
export function isProfile(value: unknown): value is AlumniProfile {
  const candidate = value as Partial<AlumniProfile> | null;
  return !!candidate && !!candidate.user && typeof candidate.user.id === "string" && Array.isArray(candidate.skills);
}

export function isList<T>(value: unknown): value is Paginated<T> {
  return !!value && Array.isArray((value as Partial<Paginated<T>>).items);
}

export function isFacets(value: unknown): value is Facets {
  const candidate = value as Partial<Facets> | null;
  return !!candidate && Array.isArray(candidate.programs) && Array.isArray(candidate.sectors) && Array.isArray(candidate.skills);
}

/** The shape GET /api/alumni/me returns before a profile is saved (and after "Delete my data"). */
export function emptyProfile(user: AlumniUser): AlumniProfile {
  return {
    id: null,
    user,
    program: null,
    promotion: null,
    headline: null,
    bio: null,
    skills: [],
    company: null,
    jobTitle: null,
    sector: null,
    city: null,
    linkedinUrl: null,
    mentoringAvailable: false,
    mentoringTopics: [],
    visibility: "PRIVATE",
    consentAt: null,
    updatedAt: null,
  };
}

/** "Selim Rekik" (empty string when unknown). */
export function fullName(user: { firstname?: string | null; lastname?: string | null } | null | undefined): string {
  return user ? `${user.firstname ?? ""} ${user.lastname ?? ""}`.trim() : "";
}

/** "SR" for the avatar ("?" when unknown). */
export function initials(user: { firstname?: string | null; lastname?: string | null } | null | undefined): string {
  const first = user?.firstname?.trim()?.[0] ?? "";
  const last = user?.lastname?.trim()?.[0] ?? "";
  return `${first}${last}`.toUpperCase() || "?";
}
