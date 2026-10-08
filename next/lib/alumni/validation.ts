// Checks of the alumni forms, run in the browser first and again in the Server Actions (same limits as the API).
// They return keys of `alumni.validation.*` (messages/<locale>/alumni.json) with their values.
import {
  BIO_MAX_LENGTH,
  CITY_MAX_LENGTH,
  COMPANY_MAX_LENGTH,
  HEADLINE_MAX_LENGTH,
  HIDE_REASON_MAX_LENGTH,
  isObjectId,
  isPostType,
  JOB_TITLE_MAX_LENGTH,
  LINKEDIN_URL_MAX_LENGTH,
  MAX_MENTORING_TOPICS,
  MAX_SKILLS,
  MENTORING_TOPIC_MAX_LENGTH,
  MENTORING_TOPIC_MIN_LENGTH,
  MESSAGE_MAX_LENGTH,
  MESSAGE_MIN_LENGTH,
  POST_BODY_MAX_LENGTH,
  POST_BODY_MIN_LENGTH,
  POST_LINK_MAX_LENGTH,
  PROMOTION_MIN,
  REPLY_MAX_LENGTH,
  SECTOR_MAX_LENGTH,
  SKILL_MAX_LENGTH,
  TOPIC_MAX_LENGTH,
  TOPIC_MIN_LENGTH,
  type PostType,
} from "@/lib/alumni/types";

export type AlumniValidationKey =
  | "tooLong"
  | "programInvalid"
  | "promotionInvalid"
  | "linkedinInvalid"
  | "skillsTooMany"
  | "skillInvalid"
  | "topicsTooMany"
  | "topicItemInvalid"
  | "topicTooShort"
  | "topicTooLong"
  | "messageTooShort"
  | "messageTooLong"
  | "replyTooLong"
  | "typeRequired"
  | "postTooShort"
  | "postTooLong"
  | "linkInvalid"
  | "reasonTooLong"
  | "consentRequired"
  | "confirmationMismatch";

export type AlumniValidationError = { key: AlumniValidationKey; values?: Record<string, number | string> };
export type AlumniValidationErrors = Record<string, AlumniValidationError>;

export function hasValidationErrors(errors: AlumniValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Same normalisation as the API: line breaks as LF, trimmed. */
export const normalizeText = (value: string) => value.replace(/\r\n?/g, "\n").trim();
/** One-line fields: whitespace runs become one space. */
export const normalizeLine = (value: string) => value.replace(/\s+/g, " ").trim();

/** Lowercase without accents: "Développement" and "developpement" are the same skill. */
export const foldKey = (value: string) =>
  normalizeLine(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** Adds an item to a list unless it is empty or already there (ignoring case and accents). */
export function addToList(list: readonly string[], value: string): string[] {
  const item = normalizeLine(value);
  if (!item || list.some((entry) => foldKey(entry) === foldKey(item))) return [...list];
  return [...list, item];
}

/** "linkedin.com/in/x" → "https://linkedin.com/in/x" (a scheme is added when none was typed). */
export function withScheme(value: string): string {
  const text = value.trim();
  if (!text) return "";
  return /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
}

/** https:// URL without credentials, optionally on one of `hosts` (subdomains included). */
export function isHttpsUrl(value: string, { max, hosts }: { max: number; hosts?: string[] }): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (hosts && !hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) return false;
  return url.href.length <= max;
}

/** Latest graduation year accepted by the API (next year). */
export const maxPromotion = () => new Date().getFullYear() + 1;

// ---------- Profile

/** What the profile form edits (visibility and consent have their own action). */
export type ProfileInput = {
  program: string;
  promotion: string;
  headline: string;
  bio: string;
  skills: string[];
  company: string;
  jobTitle: string;
  sector: string;
  city: string;
  linkedinUrl: string;
  mentoringAvailable: boolean;
  mentoringTopics: string[];
};

/** The JSON body of PUT /api/alumni/me (null clears a field). */
export type ProfilePayload = {
  program: string | null;
  promotion: number | null;
  headline: string | null;
  bio: string | null;
  skills: string[];
  company: string | null;
  jobTitle: string | null;
  sector: string | null;
  city: string | null;
  linkedinUrl: string | null;
  mentoringAvailable: boolean;
  mentoringTopics: string[];
};

function optionalLine(value: string, field: string, max: number, errors: AlumniValidationErrors): string | null {
  const text = normalizeLine(value);
  if (text.length > max) errors[field] = { key: "tooLong", values: { max } };
  return text || null;
}

function cleanList(values: readonly string[]): string[] {
  return values.reduce<string[]>((list, value) => addToList(list, value), []);
}

export function validateProfile(input: ProfileInput): { errors: AlumniValidationErrors; payload: ProfilePayload } {
  const errors: AlumniValidationErrors = {};

  const program = input.program.trim();
  if (program && !isObjectId(program)) errors.program = { key: "programInvalid" };

  const promotionText = input.promotion.trim();
  let promotion: number | null = null;
  if (promotionText) {
    promotion = /^\d{4}$/.test(promotionText) ? Number(promotionText) : Number.NaN;
    const max = maxPromotion();
    if (!Number.isInteger(promotion) || promotion < PROMOTION_MIN || promotion > max) {
      errors.promotion = { key: "promotionInvalid", values: { min: PROMOTION_MIN, max } };
    }
  }

  const headline = optionalLine(input.headline, "headline", HEADLINE_MAX_LENGTH, errors);
  const bioText = normalizeText(input.bio);
  if (bioText.length > BIO_MAX_LENGTH) errors.bio = { key: "tooLong", values: { max: BIO_MAX_LENGTH } };
  const company = optionalLine(input.company, "company", COMPANY_MAX_LENGTH, errors);
  const jobTitle = optionalLine(input.jobTitle, "jobTitle", JOB_TITLE_MAX_LENGTH, errors);
  const sector = optionalLine(input.sector, "sector", SECTOR_MAX_LENGTH, errors);
  const city = optionalLine(input.city, "city", CITY_MAX_LENGTH, errors);

  const linkedinText = withScheme(input.linkedinUrl);
  if (linkedinText && !isHttpsUrl(linkedinText, { max: LINKEDIN_URL_MAX_LENGTH, hosts: ["linkedin.com"] })) {
    errors.linkedinUrl = { key: "linkedinInvalid" };
  }

  const skills = cleanList(input.skills);
  if (skills.length > MAX_SKILLS) errors.skills = { key: "skillsTooMany", values: { max: MAX_SKILLS } };
  else if (skills.some((skill) => skill.length > SKILL_MAX_LENGTH)) errors.skills = { key: "skillInvalid", values: { max: SKILL_MAX_LENGTH } };

  const mentoringTopics = cleanList(input.mentoringTopics);
  if (mentoringTopics.length > MAX_MENTORING_TOPICS) {
    errors.mentoringTopics = { key: "topicsTooMany", values: { max: MAX_MENTORING_TOPICS } };
  } else if (mentoringTopics.some((topic) => topic.length < MENTORING_TOPIC_MIN_LENGTH || topic.length > MENTORING_TOPIC_MAX_LENGTH)) {
    errors.mentoringTopics = { key: "topicItemInvalid", values: { min: MENTORING_TOPIC_MIN_LENGTH, max: MENTORING_TOPIC_MAX_LENGTH } };
  }

  return {
    errors,
    payload: {
      program: program || null,
      promotion: promotion !== null && Number.isInteger(promotion) ? promotion : null,
      headline,
      bio: bioText || null,
      skills,
      company,
      jobTitle,
      sector,
      city,
      linkedinUrl: linkedinText || null,
      mentoringAvailable: input.mentoringAvailable === true,
      mentoringTopics,
    },
  };
}

/** One item typed in the skills / mentoring topics editors, before it is added. */
export function validateListItem(kind: "skills" | "mentoringTopics", value: string, list: readonly string[]): AlumniValidationError | null {
  const item = normalizeLine(value);
  if (!item) return null;
  if (kind === "skills") {
    if (list.length >= MAX_SKILLS) return { key: "skillsTooMany", values: { max: MAX_SKILLS } };
    if (item.length > SKILL_MAX_LENGTH) return { key: "skillInvalid", values: { max: SKILL_MAX_LENGTH } };
    return null;
  }
  if (list.length >= MAX_MENTORING_TOPICS) return { key: "topicsTooMany", values: { max: MAX_MENTORING_TOPICS } };
  if (item.length < MENTORING_TOPIC_MIN_LENGTH || item.length > MENTORING_TOPIC_MAX_LENGTH) {
    return { key: "topicItemInvalid", values: { min: MENTORING_TOPIC_MIN_LENGTH, max: MENTORING_TOPIC_MAX_LENGTH } };
  }
  return null;
}

// ---------- Mentoring

export type MentoringInput = { topic: string; message: string };

export function validateMentoringRequest(input: MentoringInput): { errors: AlumniValidationErrors; payload: MentoringInput } {
  const errors: AlumniValidationErrors = {};
  const topic = normalizeLine(input.topic);
  const message = normalizeText(input.message);
  if (topic.length < TOPIC_MIN_LENGTH) errors.topic = { key: "topicTooShort", values: { min: TOPIC_MIN_LENGTH } };
  else if (topic.length > TOPIC_MAX_LENGTH) errors.topic = { key: "topicTooLong", values: { max: TOPIC_MAX_LENGTH } };
  if (message.length < MESSAGE_MIN_LENGTH) errors.message = { key: "messageTooShort", values: { min: MESSAGE_MIN_LENGTH } };
  else if (message.length > MESSAGE_MAX_LENGTH) errors.message = { key: "messageTooLong", values: { max: MESSAGE_MAX_LENGTH } };
  return { errors, payload: { topic, message } };
}

export function validateReply(value: string): AlumniValidationError | null {
  return normalizeText(value).length > REPLY_MAX_LENGTH ? { key: "replyTooLong", values: { max: REPLY_MAX_LENGTH } } : null;
}

export function validateHideReason(value: string): AlumniValidationError | null {
  return normalizeText(value).length > HIDE_REASON_MAX_LENGTH ? { key: "reasonTooLong", values: { max: HIDE_REASON_MAX_LENGTH } } : null;
}

// ---------- News wall

export type PostInput = { type: string; body: string; link: string };
export type PostPayload = { type: PostType; body: string; link: string | null };

export function validatePost(input: PostInput): { errors: AlumniValidationErrors; payload: PostPayload } {
  const errors: AlumniValidationErrors = {};
  if (!isPostType(input.type)) errors.type = { key: "typeRequired" };
  const body = normalizeText(input.body);
  if (body.length < POST_BODY_MIN_LENGTH) errors.body = { key: "postTooShort", values: { min: POST_BODY_MIN_LENGTH } };
  else if (body.length > POST_BODY_MAX_LENGTH) errors.body = { key: "postTooLong", values: { max: POST_BODY_MAX_LENGTH } };
  const link = withScheme(input.link);
  if (link && !isHttpsUrl(link, { max: POST_LINK_MAX_LENGTH })) errors.link = { key: "linkInvalid" };
  return { errors, payload: { type: (isPostType(input.type) ? input.type : "OTHER") as PostType, body, link: link || null } };
}

// ---------- Erasure

/** Words accepted by "Delete my data" (the one of the page's language is asked for). */
export const ERASE_CONFIRMATION_WORDS = ["DELETE", "SUPPRIMER"] as const;

export function isEraseConfirmation(value: string, expected?: string): boolean {
  const typed = normalizeLine(value).toUpperCase();
  return expected ? typed === expected.toUpperCase() : (ERASE_CONFIRMATION_WORDS as readonly string[]).includes(typed);
}
