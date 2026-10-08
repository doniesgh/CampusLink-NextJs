// Module 4 (help forum): shapes of /api/forum (docs/phase2-contract.md section 2, backend/docs/forum.md).
// Types and constants only: usable from Server and Client Components.
import type { Paginated, Role, Subject } from "@/lib/types";

/** `{ id, firstname, lastname, role }`; null when the account is unknown. Never an email. */
export type ForumUser = { id: string; firstname: string; lastname: string; role: Role | null };
export type ForumAuthor = ForumUser | null;

/** 1 = upvoted, -1 = downvoted, 0 = no vote. */
export type VoteValue = 1 | -1 | 0;
export type QuestionStatus = "OPEN" | "CLOSED";

export type Question = {
  id: string;
  title: string;
  /** Plain text: keep the line breaks, never render it as HTML. */
  body: string;
  /** null when the subject was deleted. */
  subject: Subject | null;
  chapter: string | null;
  level: number | null;
  tags: string[];
  author: ForumAuthor;
  score: number;
  /** Visible (not hidden) answers. */
  answerCount: number;
  acceptedAnswerId: string | null;
  hasCertifiedAnswer: boolean;
  following: boolean;
  myVote: VoteValue;
  viewCount: number;
  status: QuestionStatus;
  /** Only ADMINs and the author receive hidden content. */
  hidden: boolean;
  hiddenAt?: string | null;
  hiddenReason?: string | null;
  createdAt: string;
  lastActivityAt: string;
  editedAt?: string | null;
};

export type Answer = {
  id: string;
  questionId: string;
  /** Plain text: keep the line breaks, never render it as HTML. */
  body: string;
  author: ForumAuthor;
  /** Written by a TEACHER. */
  certified: boolean;
  accepted: boolean;
  score: number;
  myVote: VoteValue;
  hidden?: boolean;
  hiddenAt?: string | null;
  hiddenReason?: string | null;
  createdAt: string;
  editedAt: string | null;
};

/** GET /api/forum/questions/:id (answers: accepted first, then score, then oldest). */
export type QuestionDetail = { question: Question; answers: Answer[] };

export type QuestionList = Paginated<Question>;

/** GET /api/forum/questions/similar?title= (a bare array of up to 5). */
export type SimilarQuestion = { id: string; title: string; answerCount: number; hasAcceptedAnswer: boolean };

/** GET /api/forum/tags (most used first). */
export type TagCount = { tag: string; count: number };

export const BADGE_CODES = ["FIRST_ANSWER", "ACTIVE_CONTRIBUTOR", "HELPFUL", "SUBJECT_EXPERT"] as const;
export type BadgeCode = (typeof BADGE_CODES)[number];

export type ForumBadge = {
  code: string;
  /** SUBJECT_EXPERT only. */
  subject?: Partial<Subject> & { id: string };
  awardedAt: string;
};

export type ProfileSubject = { subject: Subject; points: number; answers: number };

/** GET /api/forum/profiles/:userId and /profiles/me. */
export type ForumProfile = {
  user: ForumUser;
  reputation: number;
  questions: number;
  answers: number;
  acceptedAnswers: number;
  bySubject: Record<string, number>;
  subjects: ProfileSubject[];
  badges: ForumBadge[];
  season: { academicYear: string; reputation: number };
};

export type LeaderboardEntry = { rank: number; user: ForumUser; reputation: number; badges: number };

/** GET /api/forum/leaderboard: reputation earned during the current academic year. */
export type Leaderboard = { academicYear: string; subject: Subject | null; items: LeaderboardEntry[] };

export type ReportStatus = "OPEN" | "RESOLVED";
export type ReportOutcome = "HIDDEN" | "NO_ACTION";
export type ReportTargetType = "QUESTION" | "ANSWER";

/** ADMIN view of a report (GET /api/forum/reports). */
export type ForumReport = {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  questionId: string;
  reason: string;
  status: ReportStatus;
  outcome: ReportOutcome | null;
  note: string | null;
  reporter: ForumUser | null;
  /** null when the content was deleted. */
  target: { title: string | null; excerpt: string; author: ForumAuthor; hidden: boolean } | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: ForumUser | null;
};

export type ReportList = Paginated<ForumReport> & { openCount: number };

/** Moderation and report targets in API paths: /api/forum/<target>/:id/... */
export type ForumTarget = "questions" | "answers";

// Limits of the backend (models/forum*Model.js), checked in the browser first.
export const TITLE_MIN_LENGTH = 10;
export const TITLE_MAX_LENGTH = 200;
export const BODY_MIN_LENGTH = 20;
export const BODY_MAX_LENGTH = 10_000;
export const ANSWER_MIN_LENGTH = 2;
export const ANSWER_MAX_LENGTH = 10_000;
export const CHAPTER_MAX_LENGTH = 100;
export const MAX_TAGS = 5;
export const TAG_MIN_LENGTH = 2;
export const TAG_MAX_LENGTH = 30;
/** Lowercase letters, digits and + # . _ - (starts with a letter or a digit). */
export const TAG_PATTERN = /^[\p{Ll}\p{Lo}\p{N}][\p{Ll}\p{Lo}\p{N}+#._-]*$/u;
export const LEVELS = [1, 2, 3, 4, 5] as const;
export const REASON_MIN_LENGTH = 5;
export const REASON_MAX_LENGTH = 500;
export const NOTE_MAX_LENGTH = 500;

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export function isObjectId(value: unknown): value is string {
  return typeof value === "string" && OBJECT_ID_RE.test(value);
}

/** Loose runtime checks of API answers (offline copies, failed snapshots). */
export function isQuestion(value: unknown): value is Question {
  const candidate = value as Partial<Question> | null;
  return !!candidate && typeof candidate.id === "string" && typeof candidate.title === "string" && typeof candidate.body === "string";
}

export function isQuestionDetail(value: unknown): value is QuestionDetail {
  const candidate = value as Partial<QuestionDetail> | null;
  return !!candidate && isQuestion(candidate.question) && Array.isArray(candidate.answers);
}

export function isQuestionList(value: unknown): value is QuestionList {
  return !!value && Array.isArray((value as Partial<QuestionList>).items);
}

export function isProfile(value: unknown): value is ForumProfile {
  const candidate = value as Partial<ForumProfile> | null;
  return !!candidate && !!candidate.user && typeof candidate.user.id === "string";
}
