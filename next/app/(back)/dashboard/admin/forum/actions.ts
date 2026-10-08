"use server";

import { refresh } from "next/cache";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/dal";
import { actionFailure, actionSuccess, serverApi, type ActionState } from "@/lib/server-api";
import { moderationHref } from "@/lib/forum/paths";
import { isObjectId, NOTE_MAX_LENGTH, REASON_MAX_LENGTH, type Answer, type ForumTarget, type Question } from "@/lib/forum/types";
import { normalizeText } from "@/lib/forum/validation";

/*
 * Moderation (ADMIN): hide / unhide a question or an answer, resolve a report. Used by /dashboard/admin/forum
 * (`refreshPage: true` renders the reports queue again) and by the question page (which updates its own data).
 */

const TARGETS = new Set<ForumTarget>(["questions", "answers"]);

async function ensureAdmin<T = undefined>(): Promise<ActionState<T> | null> {
  const { user, error } = await requireRole(["ADMIN"], moderationHref);
  return user ? null : actionFailure<T>(error);
}

/** "Hide" (optional reason shown to the author) / "Unhide": idempotent, closes the open reports of the content. */
export async function setHiddenAction(
  target: ForumTarget,
  id: string,
  hidden: boolean,
  options: { reason?: string; refreshPage?: boolean } = {}
): Promise<ActionState<Question | Answer>> {
  const denied = await ensureAdmin<Question | Answer>();
  if (denied) return denied;
  const reason = typeof options.reason === "string" ? normalizeText(options.reason).slice(0, REASON_MAX_LENGTH) : "";
  if (!TARGETS.has(target) || !isObjectId(id)) return actionFailure(new Error("Invalid input"));

  let content: Question | Answer;
  try {
    content = await serverApi<Question | Answer>(`/forum/${target}/${encodeURIComponent(id)}/${hidden ? "hide" : "unhide"}`, {
      method: "POST",
      body: hidden && reason ? { reason } : {},
    });
  } catch (e) {
    return actionFailure(e);
  }
  if (options.refreshPage) refresh();
  const t = await getTranslations("forum.moderation");
  return actionSuccess(t(hidden ? "hidden" : "unhidden"), { data: content });
}

/** "Resolve" with an optional note: outcome HIDDEN when the content is hidden at that time, else NO_ACTION. */
export async function resolveReportAction(id: string, note?: string): Promise<ActionState> {
  const denied = await ensureAdmin();
  if (denied) return denied;
  if (!isObjectId(id)) return actionFailure(new Error("Invalid input"));
  const cleanNote = typeof note === "string" ? normalizeText(note).slice(0, NOTE_MAX_LENGTH) : "";

  const t = await getTranslations("forum.moderation");
  try {
    await serverApi(`/forum/reports/${encodeURIComponent(id)}/resolve`, { method: "POST", body: cleanNote ? { note: cleanNote } : {} });
  } catch (e) {
    const state = await actionFailure<undefined>(e);
    if (state.code === "INVALID_STATE") {
      refresh();
      return { ...state, message: t("alreadyResolved") };
    }
    return state;
  }
  refresh();
  return actionSuccess(t("resolvedDone"));
}
