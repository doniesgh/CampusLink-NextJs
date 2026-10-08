// Checks of the forum forms, run in the browser first and again in the Server Actions (same limits as the API).
// They return keys of `forum.validation.*` (messages/<locale>/forum.json) with their values.
import {
  ANSWER_MAX_LENGTH,
  ANSWER_MIN_LENGTH,
  BODY_MAX_LENGTH,
  BODY_MIN_LENGTH,
  CHAPTER_MAX_LENGTH,
  isObjectId,
  LEVELS,
  MAX_TAGS,
  REASON_MAX_LENGTH,
  REASON_MIN_LENGTH,
  TAG_MAX_LENGTH,
  TAG_MIN_LENGTH,
  TAG_PATTERN,
  TITLE_MAX_LENGTH,
  TITLE_MIN_LENGTH,
} from "@/lib/forum/types";

export type ForumValidationKey =
  | "titleTooShort"
  | "titleTooLong"
  | "bodyTooShort"
  | "bodyTooLong"
  | "subjectRequired"
  | "chapterTooLong"
  | "levelInvalid"
  | "tooManyTags"
  | "tagInvalid"
  | "answerTooShort"
  | "answerTooLong"
  | "reasonTooShort"
  | "reasonTooLong";

export type ForumValidationError = { key: ForumValidationKey; values?: Record<string, number> };
export type ForumValidationErrors = Record<string, ForumValidationError>;

/** What the ask / edit form sends (tags typed as "sql, joins"). */
export type QuestionInput = { title: string; body: string; subject: string; chapter: string; level: string; tags: string };

/** The JSON body of POST/PATCH /api/forum/questions. */
export type QuestionPayload = {
  title: string;
  body: string;
  subject: string;
  chapter: string | null;
  level: number | null;
  tags: string[];
};

/** Same normalisation as the API: line breaks as LF, title on one line. */
export const normalizeText = (value: string) => value.replace(/\r\n?/g, "\n").trim();
export const normalizeTitle = (value: string) => value.replace(/\s+/g, " ").trim();

/** "SQL, Left Join ,sql" -> ["sql", "left-join"] (lowercase, spaces -> "-", no duplicates). */
export function parseTags(value: string): string[] {
  const tags: string[] = [];
  for (const raw of value.split(",")) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, "-");
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

export function validateQuestion(input: QuestionInput): { errors: ForumValidationErrors; payload: QuestionPayload } {
  const errors: ForumValidationErrors = {};
  const title = normalizeTitle(input.title);
  const body = normalizeText(input.body);
  const chapter = input.chapter.trim();
  const tags = parseTags(input.tags);

  if (title.length < TITLE_MIN_LENGTH) errors.title = { key: "titleTooShort", values: { min: TITLE_MIN_LENGTH } };
  else if (title.length > TITLE_MAX_LENGTH) errors.title = { key: "titleTooLong", values: { max: TITLE_MAX_LENGTH } };
  if (body.length < BODY_MIN_LENGTH) errors.body = { key: "bodyTooShort", values: { min: BODY_MIN_LENGTH } };
  else if (body.length > BODY_MAX_LENGTH) errors.body = { key: "bodyTooLong", values: { max: BODY_MAX_LENGTH } };
  if (!isObjectId(input.subject)) errors.subject = { key: "subjectRequired" };
  if (chapter.length > CHAPTER_MAX_LENGTH) errors.chapter = { key: "chapterTooLong", values: { max: CHAPTER_MAX_LENGTH } };
  const level = input.level ? Number(input.level) : null;
  if (level !== null && !(LEVELS as readonly number[]).includes(level)) errors.level = { key: "levelInvalid" };
  if (tags.length > MAX_TAGS) errors.tags = { key: "tooManyTags", values: { max: MAX_TAGS } };
  else if (tags.some((tag) => tag.length < TAG_MIN_LENGTH || tag.length > TAG_MAX_LENGTH || !TAG_PATTERN.test(tag))) {
    errors.tags = { key: "tagInvalid", values: { min: TAG_MIN_LENGTH, max: TAG_MAX_LENGTH } };
  }

  return { errors, payload: { title, body, subject: input.subject, chapter: chapter || null, level, tags } };
}

export function validateAnswer(value: string): ForumValidationError | null {
  const body = normalizeText(value);
  if (body.length < ANSWER_MIN_LENGTH) return { key: "answerTooShort", values: { min: ANSWER_MIN_LENGTH } };
  if (body.length > ANSWER_MAX_LENGTH) return { key: "answerTooLong", values: { max: ANSWER_MAX_LENGTH } };
  return null;
}

export function validateReason(value: string): ForumValidationError | null {
  const reason = normalizeText(value);
  if (reason.length < REASON_MIN_LENGTH) return { key: "reasonTooShort", values: { min: REASON_MIN_LENGTH } };
  if (reason.length > REASON_MAX_LENGTH) return { key: "reasonTooLong", values: { max: REASON_MAX_LENGTH } };
  return null;
}

export function hasValidationErrors(errors: ForumValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}
