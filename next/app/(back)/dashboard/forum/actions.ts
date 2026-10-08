"use server";

import { getTranslations } from "next-intl/server";
import { actionFailure, actionSuccess, serverApi, type ActionState } from "@/lib/server-api";
import { questionPath } from "@/lib/forum/paths";
import {
  isObjectId,
  type Answer,
  type ForumTarget,
  type Question,
  type QuestionDetail,
  type QuestionStatus,
  type VoteValue,
} from "@/lib/forum/types";
import {
  hasValidationErrors,
  normalizeText,
  validateAnswer,
  validateQuestion,
  validateReason,
  type ForumValidationErrors,
  type QuestionInput,
} from "@/lib/forum/validation";

/*
 * Forum mutations that can fail with an expected 4xx (docs: next/README.md "Data layer"): run on the server with
 * serverApi(), so the browser never logs a failed request. Answers are the exception: they go through
 * queueMutation() (components/forum/answer-form.tsx) to work offline.
 * The pages update their offline query with the returned data (no server re-render).
 */

/** Forum wording of some backend codes (messages: forum.errors.*). */
type ForumErrorKey =
  | "errors.voteOwn"
  | "errors.hiddenContent"
  | "errors.acceptForbidden"
  | "errors.editForbidden"
  | "errors.deleteHasAnswers"
  | "errors.deleteAccepted";

const TARGETS = new Set<ForumTarget>(["questions", "answers"]);

function invalidInput<T>(): Promise<ActionState<T>> {
  return actionFailure<T>(new Error("Invalid input"));
}

/** Localised field errors of the forum forms. */
async function validationFailure<T>(errors: ForumValidationErrors): Promise<ActionState<T>> {
  const t = await getTranslations("forum.validation");
  const fieldErrors = Object.fromEntries(Object.entries(errors).map(([field, error]) => [field, t(error.key, error.values)]));
  return { ok: false, code: "VALIDATION_ERROR", message: Object.values(fieldErrors).join(" "), fieldErrors, at: Date.now() };
}

/**
 * Backend error -> localised state. `context` picks the forum wording of the codes whose generic text would be
 * too vague here (403 on a vote, 409 on a closed question...).
 */
async function forumFailure<T>(
  error: unknown,
  context: { forbidden?: ForumErrorKey; invalidState?: ForumErrorKey } = {}
): Promise<ActionState<T>> {
  const state = await actionFailure<T>(error);
  const t = await getTranslations("forum");
  if (state.code === "FORBIDDEN" && context.forbidden) return { ...state, message: t(context.forbidden) };
  if (state.code === "INVALID_STATE" && context.invalidState) return { ...state, message: t(context.invalidState) };
  if (state.code === "RESOURCE_NOT_FOUND") return { ...state, message: t("errors.notFound") };
  return state;
}

// ---------- Questions

/** "Post question": POST /api/forum/questions → the new question's id (the page opens it). */
export async function createQuestionAction(input: QuestionInput): Promise<ActionState<{ id: string }>> {
  const { errors, payload } = validateQuestion(input);
  if (hasValidationErrors(errors)) return validationFailure(errors);
  try {
    const question = await serverApi<Question>("/forum/questions", { method: "POST", body: payload });
    return actionSuccess(undefined, { data: { id: question.id } });
  } catch (e) {
    return forumFailure(e);
  }
}

/** "Save changes" of the author's edit form: PATCH /api/forum/questions/:id. */
export async function updateQuestionAction(id: string, input: QuestionInput): Promise<ActionState<Question>> {
  if (!isObjectId(id)) return invalidInput();
  const { errors, payload } = validateQuestion(input);
  if (hasValidationErrors(errors)) return validationFailure(errors);
  try {
    const question = await serverApi<Question>(questionPath(id), { method: "PATCH", body: payload });
    const t = await getTranslations("forum.question");
    return actionSuccess(t("saved"), { data: question });
  } catch (e) {
    return forumFailure(e, { forbidden: "errors.editForbidden" });
  }
}

/** "Close question" / "Reopen question" (author or ADMIN): PATCH { status }. */
export async function setQuestionStatusAction(id: string, status: QuestionStatus): Promise<ActionState<Question>> {
  if (!isObjectId(id) || (status !== "OPEN" && status !== "CLOSED")) return invalidInput();
  try {
    const question = await serverApi<Question>(questionPath(id), { method: "PATCH", body: { status } });
    const t = await getTranslations("forum.question");
    return actionSuccess(t(status === "CLOSED" ? "closedDone" : "reopenedDone"), { data: question });
  } catch (e) {
    return forumFailure(e, { forbidden: "errors.editForbidden" });
  }
}

/** "Delete" (author or ADMIN, only while the question has no answer). */
export async function deleteQuestionAction(id: string): Promise<ActionState> {
  if (!isObjectId(id)) return invalidInput();
  try {
    await serverApi(questionPath(id), { method: "DELETE" });
    return actionSuccess();
  } catch (e) {
    return forumFailure(e, { forbidden: "errors.editForbidden", invalidState: "errors.deleteHasAnswers" });
  }
}

/** "Follow" / "Unfollow": POST | DELETE /api/forum/questions/:id/follow → { following }. */
export async function followQuestionAction(id: string, follow: boolean): Promise<ActionState<{ following: boolean }>> {
  if (!isObjectId(id)) return invalidInput();
  try {
    const result = await serverApi<{ following: boolean }>(`${questionPath(id)}/follow`, { method: follow ? "POST" : "DELETE" });
    const t = await getTranslations("forum.question");
    return actionSuccess(t(result.following ? "followed" : "unfollowed"), { data: result });
  } catch (e) {
    return forumFailure(e, { invalidState: "errors.hiddenContent" });
  }
}

/** "Accept this answer" / "Remove acceptance" (question author only) → the whole thread, re-sorted. */
export async function acceptAnswerAction(questionId: string, answerId: string | null): Promise<ActionState<QuestionDetail>> {
  if (!isObjectId(questionId) || (answerId !== null && !isObjectId(answerId))) return invalidInput();
  try {
    const detail = await serverApi<QuestionDetail>(`${questionPath(questionId)}/accept`, { method: "POST", body: { answerId } });
    const t = await getTranslations("forum.answers");
    return actionSuccess(t(answerId ? "acceptedDone" : "unacceptedDone"), { data: detail });
  } catch (e) {
    return forumFailure(e, { forbidden: "errors.acceptForbidden", invalidState: "errors.hiddenContent" });
  }
}

// ---------- Answers

/** "Save answer" of the author's edit form: PATCH /api/forum/answers/:id. */
export async function updateAnswerAction(id: string, body: string): Promise<ActionState<Answer>> {
  if (!isObjectId(id) || typeof body !== "string") return invalidInput();
  const error = validateAnswer(body);
  if (error) return validationFailure({ body: error });
  try {
    const answer = await serverApi<Answer>(`/forum/answers/${encodeURIComponent(id)}`, { method: "PATCH", body: { body: normalizeText(body) } });
    const t = await getTranslations("forum.answers");
    return actionSuccess(t("saved"), { data: answer });
  } catch (e) {
    return forumFailure(e, { forbidden: "errors.editForbidden" });
  }
}

/** "Delete" of an answer (author or ADMIN, not the accepted one). */
export async function deleteAnswerAction(id: string): Promise<ActionState> {
  if (!isObjectId(id)) return invalidInput();
  try {
    await serverApi(`/forum/answers/${encodeURIComponent(id)}`, { method: "DELETE" });
    const t = await getTranslations("forum.answers");
    return actionSuccess(t("deleted"));
  } catch (e) {
    return forumFailure(e, { forbidden: "errors.editForbidden", invalidState: "errors.deleteAccepted" });
  }
}

// ---------- Votes and reports (questions and answers)

/** "Upvote" / "Downvote": the same value again removes the vote → { score, myVote }. */
export async function voteAction(
  target: ForumTarget,
  id: string,
  value: 1 | -1
): Promise<ActionState<{ score: number; myVote: VoteValue }>> {
  if (!TARGETS.has(target) || !isObjectId(id) || (value !== 1 && value !== -1)) return invalidInput();
  try {
    const result = await serverApi<{ score: number; myVote: VoteValue }>(`/forum/${target}/${encodeURIComponent(id)}/vote`, {
      method: "POST",
      body: { value },
    });
    return actionSuccess(undefined, { data: result });
  } catch (e) {
    return forumFailure(e, { forbidden: "errors.voteOwn", invalidState: "errors.hiddenContent" });
  }
}

/** "Send report": POST /api/forum/{questions|answers}/:id/report { reason }. */
export async function reportAction(target: ForumTarget, id: string, reason: string): Promise<ActionState> {
  if (!TARGETS.has(target) || !isObjectId(id) || typeof reason !== "string") return invalidInput();
  const error = validateReason(reason);
  if (error) return validationFailure({ reason: error });
  try {
    await serverApi(`/forum/${target}/${encodeURIComponent(id)}/report`, { method: "POST", body: { reason: normalizeText(reason) } });
    const t = await getTranslations("forum.report");
    return actionSuccess(t("sent"));
  } catch (e) {
    return forumFailure(e);
  }
}
