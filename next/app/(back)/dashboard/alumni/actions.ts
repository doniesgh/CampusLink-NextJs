"use server";

import { getTranslations } from "next-intl/server";
import { toApiError } from "@/lib/api";
import { actionFailure, actionSuccess, serverApi, type ActionState } from "@/lib/server-api";
import { MY_PROFILE_PATH, mentoringRequestPath, postPath, profilePath } from "@/lib/alumni/paths";
import { isObjectId, type AlumniPost, type AlumniProfile, type MentoringRequest } from "@/lib/alumni/types";
import {
  hasValidationErrors,
  isEraseConfirmation,
  normalizeText,
  validateHideReason,
  validateMentoringRequest,
  validatePost,
  validateProfile,
  validateReply,
  type AlumniValidationErrors,
  type MentoringInput,
  type PostInput,
  type ProfileInput,
} from "@/lib/alumni/validation";

/*
 * Alumni network mutations (docs: next/README.md "Data layer"): they can fail with an expected 4xx (consent,
 * limits, states), so they run on the server with serverApi() and the browser never logs a failed request.
 * The pages update their offline queries with the returned data (no server re-render).
 */

/** Alumni wording of some backend codes (messages: alumni.errors.*). */
type AlumniErrorKey =
  | "profileGone"
  | "requestGone"
  | "postGone"
  | "alreadyAnswered"
  | "alreadyClosed"
  | "onlyMentor"
  | "postForbidden"
  | "tooManyRequests"
  | "tooManyPosts";

type Context = { notFound?: AlumniErrorKey; invalidState?: AlumniErrorKey; forbidden?: AlumniErrorKey; tooMany?: AlumniErrorKey };

function invalidInput<T>(): Promise<ActionState<T>> {
  return actionFailure<T>(new Error("Invalid input"));
}

/** Localised field errors of the alumni forms. */
async function validationFailure<T>(errors: AlumniValidationErrors): Promise<ActionState<T>> {
  const t = await getTranslations("alumni.validation");
  const fieldErrors = Object.fromEntries(Object.entries(errors).map(([field, error]) => [field, t(error.key, error.values)]));
  return { ok: false, code: "VALIDATION_ERROR", message: Object.values(fieldErrors).join(" "), fieldErrors, at: Date.now() };
}

/** Backend error -> localised state, with the alumni wording of the module's codes. */
async function alumniFailure<T>(error: unknown, context: Context = {}): Promise<ActionState<T>> {
  const state = await actionFailure<T>(error);
  const t = await getTranslations("alumni.errors");
  const details = (toApiError(error).details ?? {}) as Record<string, unknown>;
  switch (state.code) {
    case "MENTORING_UNAVAILABLE":
      return { ...state, message: t("mentoringUnavailable") };
    case "ALREADY_REQUESTED":
      return { ...state, message: t("alreadyRequested") };
    case "MENTORING_LIMIT_REACHED":
      return { ...state, message: t("limitReached", { limit: typeof details.limit === "number" ? details.limit : 3 }) };
    case "VALIDATION_ERROR":
      if (typeof details.consent === "string") {
        const tValidation = await getTranslations("alumni.validation");
        const message = tValidation("consentRequired");
        return { ...state, message, fieldErrors: { ...state.fieldErrors, consent: message } };
      }
      return state;
    default: {
      const key =
        (state.code === "RESOURCE_NOT_FOUND" && context.notFound) ||
        (state.code === "INVALID_STATE" && context.invalidState) ||
        (state.code === "FORBIDDEN" && context.forbidden) ||
        (state.code === "TOO_MANY_REQUESTS" && context.tooMany) ||
        null;
      return key ? { ...state, message: t(key) } : state;
    }
  }
}

// ---------- My profile (ALUMNI)

/** "Save profile": PUT /api/alumni/me with every field of the form (visibility and consent untouched). */
export async function saveProfileAction(input: ProfileInput): Promise<ActionState<AlumniProfile>> {
  if (!input || typeof input !== "object" || !Array.isArray(input.skills) || !Array.isArray(input.mentoringTopics)) return invalidInput();
  const { errors, payload } = validateProfile({
    program: String(input.program ?? ""),
    promotion: String(input.promotion ?? ""),
    headline: String(input.headline ?? ""),
    bio: String(input.bio ?? ""),
    skills: input.skills.map(String),
    company: String(input.company ?? ""),
    jobTitle: String(input.jobTitle ?? ""),
    sector: String(input.sector ?? ""),
    city: String(input.city ?? ""),
    linkedinUrl: String(input.linkedinUrl ?? ""),
    mentoringAvailable: input.mentoringAvailable === true,
    mentoringTopics: input.mentoringTopics.map(String),
  });
  if (hasValidationErrors(errors)) return validationFailure(errors);
  try {
    const profile = await serverApi<AlumniProfile>(MY_PROFILE_PATH, { method: "PUT", body: payload });
    const t = await getTranslations("alumni.form");
    return actionSuccess(t("saved"), { data: profile });
  } catch (e) {
    return alumniFailure(e);
  }
}

/**
 * Visibility and consent (GDPR): "CAMPUS" needs the explicit consent box (`consent: true`, the server stamps
 * `consentAt`); "PRIVATE" withdraws the consent.
 */
export async function setVisibilityAction(visibility: "CAMPUS" | "PRIVATE", consent: boolean): Promise<ActionState<AlumniProfile>> {
  if (visibility !== "CAMPUS" && visibility !== "PRIVATE") return invalidInput();
  if (visibility === "CAMPUS" && consent !== true) return validationFailure({ consent: { key: "consentRequired" } });
  try {
    const body = visibility === "CAMPUS" ? { visibility, consent: true } : { visibility };
    const profile = await serverApi<AlumniProfile>(MY_PROFILE_PATH, { method: "PUT", body });
    const t = await getTranslations("alumni.visibility");
    return actionSuccess(t(visibility === "CAMPUS" ? "nowVisible" : "nowPrivate"), { data: profile });
  } catch (e) {
    return alumniFailure(e);
  }
}

/** "Delete my data" (right to be forgotten): DELETE /api/alumni/me after the typed confirmation. */
export async function eraseMyDataAction(confirmation: string): Promise<ActionState> {
  if (typeof confirmation !== "string") return invalidInput();
  if (!isEraseConfirmation(confirmation)) return validationFailure({ confirmation: { key: "confirmationMismatch" } });
  try {
    await serverApi(MY_PROFILE_PATH, { method: "DELETE" });
    const t = await getTranslations("alumni.data");
    return actionSuccess(t("erased"));
  } catch (e) {
    return alumniFailure(e);
  }
}

// ---------- Mentoring

/** "Send request" (STUDENT): POST /api/alumni/:id/mentoring { topic, message }. */
export async function requestMentoringAction(alumniId: string, input: MentoringInput): Promise<ActionState<MentoringRequest>> {
  if (!isObjectId(alumniId) || !input || typeof input.topic !== "string" || typeof input.message !== "string") return invalidInput();
  const { errors, payload } = validateMentoringRequest(input);
  if (hasValidationErrors(errors)) return validationFailure(errors);
  try {
    const request = await serverApi<MentoringRequest>(`${profilePath(alumniId)}/mentoring`, { method: "POST", body: payload });
    const t = await getTranslations("alumni.ask");
    return actionSuccess(t("sent"), { data: request });
  } catch (e) {
    return alumniFailure(e, { notFound: "profileGone", tooMany: "tooManyRequests" });
  }
}

/** "Accept request" / "Decline request" (the mentor), with an optional reply. */
export async function respondMentoringAction(
  id: string,
  decision: "accept" | "decline",
  reply: string
): Promise<ActionState<MentoringRequest>> {
  if (!isObjectId(id) || (decision !== "accept" && decision !== "decline") || typeof reply !== "string") return invalidInput();
  const error = validateReply(reply);
  if (error) return validationFailure({ reply: error });
  try {
    const text = normalizeText(reply);
    const request = await serverApi<MentoringRequest>(`${mentoringRequestPath(id)}/${decision}`, {
      method: "POST",
      body: text ? { reply: text } : {},
    });
    const t = await getTranslations("alumni.mentoring");
    return actionSuccess(t(decision === "accept" ? "acceptedDone" : "declinedDone"), { data: request });
  } catch (e) {
    return alumniFailure(e, { notFound: "requestGone", invalidState: "alreadyAnswered", forbidden: "onlyMentor" });
  }
}

/** "Withdraw request" (PENDING, mentee) / "End mentoring" (ACCEPTED, either side). */
export async function closeMentoringAction(id: string): Promise<ActionState<MentoringRequest>> {
  if (!isObjectId(id)) return invalidInput();
  try {
    const request = await serverApi<MentoringRequest>(`${mentoringRequestPath(id)}/close`, { method: "POST" });
    const t = await getTranslations("alumni.mentoring");
    return actionSuccess(t("closedDone"), { data: request });
  } catch (e) {
    return alumniFailure(e, { notFound: "requestGone", invalidState: "alreadyClosed" });
  }
}

// ---------- News wall

/** "Publish" (ALUMNI): POST /api/alumni/posts { type, body, link? }. */
export async function createPostAction(input: PostInput): Promise<ActionState<AlumniPost>> {
  if (!input || typeof input.type !== "string" || typeof input.body !== "string" || typeof input.link !== "string") return invalidInput();
  const { errors, payload } = validatePost(input);
  if (hasValidationErrors(errors)) return validationFailure(errors);
  try {
    const post = await serverApi<AlumniPost>("/alumni/posts", { method: "POST", body: payload.link ? payload : { type: payload.type, body: payload.body } });
    const t = await getTranslations("alumni.news");
    return actionSuccess(t("published"), { data: post });
  } catch (e) {
    return alumniFailure(e, { tooMany: "tooManyPosts" });
  }
}

/** "Delete" a post (its author or an ADMIN). */
export async function deletePostAction(id: string): Promise<ActionState> {
  if (!isObjectId(id)) return invalidInput();
  try {
    await serverApi(postPath(id), { method: "DELETE" });
    const t = await getTranslations("alumni.news");
    return actionSuccess(t("deleted"));
  } catch (e) {
    return alumniFailure(e, { notFound: "postGone", forbidden: "postForbidden" });
  }
}

/** "Hide" (optional reason shown to the author) / "Unhide" (ADMIN). */
export async function setPostHiddenAction(id: string, hidden: boolean, reason = ""): Promise<ActionState<AlumniPost>> {
  if (!isObjectId(id) || typeof hidden !== "boolean" || typeof reason !== "string") return invalidInput();
  const error = hidden ? validateHideReason(reason) : null;
  if (error) return validationFailure({ reason: error });
  try {
    const text = normalizeText(reason);
    const post = await serverApi<AlumniPost>(`${postPath(id)}/${hidden ? "hide" : "unhide"}`, {
      method: "POST",
      body: hidden && text ? { reason: text } : {},
    });
    const t = await getTranslations("alumni.news");
    return actionSuccess(t(hidden ? "hiddenDone" : "unhiddenDone"), { data: post });
  } catch (e) {
    return alumniFailure(e, { notFound: "postGone" });
  }
}
