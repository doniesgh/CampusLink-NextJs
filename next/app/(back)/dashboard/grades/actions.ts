"use server";

import { refresh } from "next/cache";
import { getTranslations } from "next-intl/server";
import { ApiError, toApiError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { isDateKey } from "@/lib/datetime";
import { actionFailure, actionSuccess, serverApi, type ActionState } from "@/lib/server-api";
import { formText } from "@/lib/validation";
import { GRADES_HREF } from "@/lib/analytics/paths";
import {
  isAssessmentType,
  isGradeSheet,
  isObjectId,
  type Assessment,
  type GradeChange,
  type GradeSheet,
} from "@/lib/analytics/types";

const TITLE_MAX_LENGTH = 200;
const MAX_MAX_SCORE = 1000;
const MAX_COEFFICIENT = 100;
const MAX_GRADES = 500;
const COMMENT_MAX_LENGTH = 500;
const FIELDS = ["title", "type", "date", "maxScore", "coefficient"] as const;
type Field = (typeof FIELDS)[number];

async function ensureStaff<T>(): Promise<ActionState<T> | null> {
  const { user, error } = await requireRole(["TEACHER", "ADMIN"], GRADES_HREF);
  return user ? null : actionFailure<T>(error);
}

/** "12,5" or "12.5" -> 12.5; anything else -> NaN. */
function parseNumber(value: string): number {
  const text = value.trim().replace(",", ".");
  return /^\d+(\.\d+)?$/.test(text) ? Number(text) : Number.NaN;
}

/** Localised failure, with the module's own reasons (NOT_TEACHING) and per-field messages. */
async function gradesFailure<T>(error: unknown, extra: Partial<ActionState<T>> = {}): Promise<ActionState<T>> {
  const apiError = toApiError(error);
  const t = await getTranslations("analytics.grades");
  const reason = (apiError.details as { reason?: unknown } | undefined)?.reason;
  if (apiError.status === 403 && reason === "NOT_TEACHING") return actionFailure<T>(error, { ...extra, message: t("errors.NOT_TEACHING") });
  if (apiError.status === 409 && reason === "PUBLISHED") return actionFailure<T>(error, { ...extra, message: t("errors.PUBLISHED") });
  if (apiError.code === "VALIDATION_ERROR" && apiError.details && typeof apiError.details === "object") {
    const details = apiError.details as Record<string, unknown>;
    const fieldErrors: Record<string, string> = {};
    for (const field of FIELDS) {
      if (typeof details[field] !== "string") continue;
      fieldErrors[field] =
        field === "maxScore" && String(details[field]).includes("above") ? t("form.errors.maxScoreBelow") : t(`form.errors.${field}`);
    }
    if (Object.keys(fieldErrors).length > 0) {
      return actionFailure<T>(error, { ...extra, fieldErrors, message: Object.values(fieldErrors).join(" ") });
    }
  }
  return actionFailure<T>(error, extra);
}

/**
 * "Create assessment" / "Save changes" of the assessment dialog: POST /api/grades/assessments (with subject and
 * group) or PATCH /api/grades/assessments/:id.
 */
export async function saveAssessmentAction(_prev: ActionState<Assessment>, formData: FormData): Promise<ActionState<Assessment>> {
  const denied = await ensureStaff<Assessment>();
  if (denied) return denied;
  const t = await getTranslations("analytics.grades");

  const id = formText(formData, "id").trim();
  const subject = formText(formData, "subject").trim();
  const group = formText(formData, "group").trim();
  const values: Record<Field, string> = {
    title: formText(formData, "title").trim(),
    type: formText(formData, "type").trim(),
    date: formText(formData, "date").trim(),
    maxScore: formText(formData, "maxScore").trim(),
    coefficient: formText(formData, "coefficient").trim(),
  };

  const fieldErrors: Record<string, string> = {};
  if (!values.title || values.title.length > TITLE_MAX_LENGTH) fieldErrors.title = t("form.errors.title");
  if (!isAssessmentType(values.type)) fieldErrors.type = t("form.errors.type");
  if (!isDateKey(values.date)) fieldErrors.date = t("form.errors.date");
  const maxScore = parseNumber(values.maxScore || "20");
  if (!(maxScore > 0 && maxScore <= MAX_MAX_SCORE)) fieldErrors.maxScore = t("form.errors.maxScore");
  const coefficient = parseNumber(values.coefficient || "1");
  if (!(coefficient > 0 && coefficient <= MAX_COEFFICIENT)) fieldErrors.coefficient = t("form.errors.coefficient");
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, code: "VALIDATION_ERROR", message: Object.values(fieldErrors).join(" "), fieldErrors, values, at: Date.now() };
  }
  if (id ? !isObjectId(id) : !isObjectId(subject) || !isObjectId(group)) {
    return actionFailure<Assessment>(new ApiError(400, "VALIDATION_ERROR", "Invalid assessment."), { values });
  }

  const body = { title: values.title, type: values.type, date: values.date, maxScore, coefficient };
  let saved: Assessment;
  try {
    saved = id
      ? await serverApi<Assessment>(`/grades/assessments/${encodeURIComponent(id)}`, { method: "PATCH", body })
      : await serverApi<Assessment>("/grades/assessments", { method: "POST", body: { ...body, subject, group } });
  } catch (e) {
    return gradesFailure<Assessment>(e, { values });
  }
  refresh();
  return actionSuccess<Assessment>(id ? t("updated", { title: saved.title }) : t("created", { title: saved.title }), { data: saved });
}

/** "Delete" (after confirmation): DELETE /api/grades/assessments/:id (its grades go too). */
export async function deleteAssessmentAction(id: string, title: string): Promise<ActionState> {
  const denied = await ensureStaff<undefined>();
  if (denied) return denied;
  if (!isObjectId(id)) return actionFailure(new ApiError(400, "INVALID_ID", "Invalid id."));
  try {
    await serverApi(`/grades/assessments/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (e) {
    return gradesFailure(e);
  }
  const t = await getTranslations("analytics.grades");
  refresh();
  return actionSuccess(t("deleted", { title }));
}

/** "Publish grades" (after confirmation): POST /api/grades/assessments/:id/publish (students are notified once). */
export async function publishAssessmentAction(id: string): Promise<ActionState<Assessment>> {
  const denied = await ensureStaff<Assessment>();
  if (denied) return denied;
  if (!isObjectId(id)) return actionFailure<Assessment>(new ApiError(400, "INVALID_ID", "Invalid id."));
  let published: Assessment;
  try {
    published = await serverApi<Assessment>(`/grades/assessments/${encodeURIComponent(id)}/publish`, { method: "POST" });
  } catch (e) {
    return gradesFailure<Assessment>(e);
  }
  const t = await getTranslations("analytics.grades");
  refresh();
  return actionSuccess<Assessment>(t("publishedDone", { title: published.title }), { data: published });
}

/** "Save grades": PUT /api/grades/assessments/:id/grades with the changed rows; returns the new sheet. */
export async function saveGradesAction(assessmentId: string, input: GradeChange[]): Promise<ActionState<GradeSheet>> {
  const denied = await ensureStaff<GradeSheet>();
  if (denied) return denied;
  const valid =
    isObjectId(assessmentId) &&
    Array.isArray(input) &&
    input.length > 0 &&
    input.length <= MAX_GRADES &&
    input.every(
      (entry) =>
        !!entry &&
        isObjectId(entry.student) &&
        (entry.score === null || (typeof entry.score === "number" && Number.isFinite(entry.score) && entry.score >= 0)) &&
        (entry.comment === undefined || (typeof entry.comment === "string" && entry.comment.length <= COMMENT_MAX_LENGTH))
    );
  if (!valid) return actionFailure<GradeSheet>(new ApiError(400, "VALIDATION_ERROR", "Invalid grades."));

  const grades = input.map((entry) =>
    entry.comment === undefined ? { student: entry.student, score: entry.score } : { student: entry.student, score: entry.score, comment: entry.comment }
  );
  try {
    const sheet = await serverApi<GradeSheet>(`/grades/assessments/${encodeURIComponent(assessmentId)}/grades`, { method: "PUT", body: { grades } });
    if (!isGradeSheet(sheet)) throw new Error("Unexpected answer");
    const t = await getTranslations("analytics.grades.sheet");
    return actionSuccess<GradeSheet>(t("saved", { count: sheet.changed ?? 0 }), { data: sheet });
  } catch (e) {
    return gradesFailure<GradeSheet>(e);
  }
}
