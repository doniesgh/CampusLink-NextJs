"use server";

import { refresh } from "next/cache";
import { getTranslations } from "next-intl/server";
import { toApiError } from "@/lib/api";
import { isDateKey, zonedTimeToUtc } from "@/lib/datetime";
import { requireRole } from "@/lib/dal";
import { translateValidation } from "@/lib/i18n/server";
import { actionFailure, actionSuccess, serverApi, type ActionState } from "@/lib/server-api";
import { isObjectId } from "@/lib/timetable/range";
import {
  SESSION_TYPES,
  type ClassSession,
  type ImportProblems,
  type ImportResult,
  type SessionConflict,
  type SessionScope,
  type SessionStatus,
  type SessionType,
} from "@/lib/timetable/types";
import { hasErrors, summarize, type ValidationErrors } from "@/lib/validation";

/** Values of the Add session / Edit session form (date "YYYY-MM-DD", times "HH:mm", campus time). */
export type SessionFormValues = {
  subject: string;
  teacher: string;
  groups: string[];
  room: string;
  date: string;
  start: string;
  end: string;
  type: string;
  notes: string;
  repeat: boolean;
  until: string;
};

export type SessionFormField = keyof SessionFormValues;

export type SessionActionData = {
  /** 409 SESSION_CONFLICT: the sessions in the way. */
  conflicts?: SessionConflict[];
  /** Sessions written by the action. */
  count?: number;
  /** Date of the first session written (to show its week). */
  date?: string;
};
export type SessionActionState = ActionState<SessionActionData>;

export type ImportActionData = { result?: ImportResult; problems?: ImportProblems };
export type ImportActionState = ActionState<ImportActionData>;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const NOTES_MAX = 1000;
const SCOPES: readonly SessionScope[] = ["occurrence", "series"];
/** Backend field names -> form field names. */
const FIELD_NAMES: Record<string, SessionFormField> = {
  startsAt: "start",
  endsAt: "end",
  "repeat.until": "until",
};

async function ensureAdmin(): Promise<SessionActionState | null> {
  const { user, error } = await requireRole(["ADMIN"], "/dashboard/admin/timetable");
  return user ? null : actionFailure(error);
}

function failed(message: string, fieldErrors: Record<string, string> = {}): SessionActionState {
  return { ok: false, message, fieldErrors, at: Date.now() };
}

/** Checks the fields being sent; returns localised messages per form field. */
async function validate(values: SessionFormValues, fields: readonly SessionFormField[], creating: boolean): Promise<Record<string, string>> {
  const t = await getTranslations("timetable.manage.form");
  const has = (field: SessionFormField) => fields.includes(field);
  const keys: ValidationErrors = {};
  const custom: Record<string, string> = {};

  if (has("subject") && !isObjectId(values.subject)) keys.subject = "required";
  if (has("teacher") && !isObjectId(values.teacher)) keys.teacher = "required";
  if (has("groups") && (values.groups.length === 0 || !values.groups.every(isObjectId))) keys.groups = "required";
  if (has("room") && values.room && !isObjectId(values.room)) keys.room = "invalidValue";
  if (has("type") && !SESSION_TYPES.includes(values.type as SessionType)) keys.type = "invalidValue";
  if (has("notes") && values.notes.length > NOTES_MAX) keys.notes = "invalidValue";
  if (has("date") || has("start") || has("end")) {
    if (!isDateKey(values.date)) keys.date = "required";
    if (!TIME_RE.test(values.start)) keys.start = "required";
    if (!TIME_RE.test(values.end)) keys.end = "required";
    else if (TIME_RE.test(values.start) && values.end <= values.start) custom.end = t("endBeforeStart");
  }
  if (creating && values.repeat) {
    if (!isDateKey(values.until)) keys.until = "required";
    else if (isDateKey(values.date) && values.until < values.date) custom.until = t("untilBeforeDate");
  }
  return { ...(await translateValidation(keys)), ...custom };
}

/** API body of the fields being sent (times as UTC ISO instants of the campus wall-clock times). */
function toBody(values: SessionFormValues, fields: readonly SessionFormField[]): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const has = (field: SessionFormField) => fields.includes(field);
  if (has("subject")) body.subject = values.subject;
  if (has("teacher")) body.teacher = values.teacher;
  if (has("groups")) body.groups = values.groups;
  if (has("room")) body.room = values.room || null;
  if (has("date") || has("start") || has("end")) {
    body.startsAt = zonedTimeToUtc(values.date, values.start).toISOString();
    body.endsAt = zonedTimeToUtc(values.date, values.end).toISOString();
  }
  if (has("type")) body.type = values.type;
  if (has("notes")) body.notes = values.notes.trim();
  return body;
}

/** Failed state from an API error: field errors renamed to the form's fields, conflicts kept. */
async function apiFailure(error: unknown): Promise<SessionActionState> {
  const failure = await actionFailure<SessionActionData>(error);
  if (failure.fieldErrors) {
    failure.fieldErrors = Object.fromEntries(
      Object.entries(failure.fieldErrors).map(([field, message]) => [FIELD_NAMES[field] ?? field, message])
    );
  }
  if (failure.code === "SESSION_CONFLICT") {
    const t = await getTranslations("timetable.manage.conflict");
    const details = toApiError(error).details as { conflicts?: unknown } | undefined;
    failure.message = t("title");
    failure.data = { conflicts: Array.isArray(details?.conflicts) ? (details.conflicts as SessionConflict[]) : [] };
  }
  return failure;
}

const ALL_FIELDS: readonly SessionFormField[] = ["subject", "teacher", "groups", "room", "date", "start", "end", "type", "notes"];

/** "Save session" of the Add session dialog: POST /api/timetable/sessions (weekly series with "Repeat weekly"). */
export async function createSessionAction(values: SessionFormValues): Promise<SessionActionState> {
  const denied = await ensureAdmin();
  if (denied) return denied;

  const fieldErrors = await validate(values, [...ALL_FIELDS, "repeat", "until"], true);
  if (hasErrors(fieldErrors)) return failed(summarize(fieldErrors), fieldErrors);

  const body = toBody(values, ALL_FIELDS);
  if (values.repeat) body.repeat = { until: values.until };

  let created: { items: ClassSession[] };
  try {
    created = await serverApi<{ items: ClassSession[]; seriesId: string | null }>("/timetable/sessions", { method: "POST", body });
  } catch (e) {
    return apiFailure(e);
  }
  const t = await getTranslations("timetable.manage");
  const count = created.items.length;
  refresh();
  return actionSuccess(count > 1 ? t("savedSeries", { count }) : t("saved"), { data: { count, date: values.date } });
}

/** "Save changes" of the Edit session dialog: PATCH with only the changed fields and the chosen scope. */
export async function updateSessionAction(
  id: string,
  values: SessionFormValues,
  fields: SessionFormField[],
  scope: SessionScope
): Promise<SessionActionState> {
  const denied = await ensureAdmin();
  if (denied) return denied;
  if (!isObjectId(id) || !SCOPES.includes(scope)) return actionFailure(new Error("invalid session"));

  const sent = fields.filter((field) => ALL_FIELDS.includes(field));
  if (sent.length === 0) {
    const t = await getTranslations("timetable.manage.form");
    return failed(t("nothingChanged"));
  }
  const fieldErrors = await validate(values, sent, false);
  if (hasErrors(fieldErrors)) return failed(summarize(fieldErrors), fieldErrors);

  let updated: { items: ClassSession[] };
  try {
    updated = await serverApi<{ items: ClassSession[] }>(`/timetable/sessions/${id}`, {
      method: "PATCH",
      body: { ...toBody(values, sent), scope },
    });
  } catch (e) {
    return apiFailure(e);
  }
  const t = await getTranslations("timetable.manage");
  const count = Math.max(1, updated.items.length);
  refresh();
  return actionSuccess(t("updated", { count }), { data: { count } });
}

/** "Confirm cancellation" (CANCELLED) and "Restore session" (SCHEDULED). */
export async function setSessionStatusAction(id: string, status: SessionStatus, scope: SessionScope): Promise<SessionActionState> {
  const denied = await ensureAdmin();
  if (denied) return denied;
  if (!isObjectId(id) || !SCOPES.includes(scope) || (status !== "CANCELLED" && status !== "SCHEDULED")) {
    return actionFailure(new Error("invalid session"));
  }

  let updated: { items: ClassSession[] };
  try {
    updated = await serverApi<{ items: ClassSession[] }>(`/timetable/sessions/${id}`, { method: "PATCH", body: { status, scope } });
  } catch (e) {
    return apiFailure(e);
  }
  const t = await getTranslations("timetable.manage");
  const count = Math.max(1, updated.items.filter((item) => item.status === status).length);
  refresh();
  return actionSuccess(status === "CANCELLED" ? t("cancelled", { count }) : t("restored", { count }), { data: { count } });
}

/** "Confirm delete": DELETE /api/timetable/sessions/:id?scope= (no notification). */
export async function deleteSessionAction(id: string, scope: SessionScope): Promise<SessionActionState> {
  const denied = await ensureAdmin();
  if (denied) return denied;
  if (!isObjectId(id) || !SCOPES.includes(scope)) return actionFailure(new Error("invalid session"));

  try {
    await serverApi(`/timetable/sessions/${id}?scope=${scope}`, { method: "DELETE" });
  } catch (e) {
    return apiFailure(e);
  }
  const t = await getTranslations("timetable.manage");
  refresh();
  return actionSuccess(t("deleted"));
}

/**
 * "Check file" (dryRun=true) and "Import" (dryRun=false) of the Import CSV dialog:
 * POST /api/timetable/import (multipart). 422 IMPORT_INVALID comes back with the report (`data.problems`).
 */
export async function importTimetableAction(formData: FormData): Promise<ImportActionState> {
  const { user, error } = await requireRole(["ADMIN"], "/dashboard/admin/timetable");
  if (!user) return actionFailure(error);
  const t = await getTranslations("timetable.manage.importDialog");

  const file = formData.get("file");
  const dryRun = formData.get("dryRun") === "true";
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: t("chooseFile"), fieldErrors: { file: t("chooseFile") }, at: Date.now() };
  }

  const body = new FormData();
  body.append("file", file, file.name || "timetable.csv");
  body.append("dryRun", String(dryRun));

  let result: ImportResult;
  try {
    result = await serverApi<ImportResult>("/timetable/import", { method: "POST", body });
  } catch (e) {
    const failure = await actionFailure<ImportActionData>(e);
    if (failure.code === "IMPORT_INVALID") {
      const details = (toApiError(e).details ?? {}) as Partial<ImportProblems>;
      failure.message = dryRun ? t("invalidCheck") : t("invalid");
      failure.data = {
        problems: {
          errors: Array.isArray(details.errors) ? details.errors : [],
          conflicts: Array.isArray(details.conflicts) ? details.conflicts : [],
          rows: typeof details.rows === "number" ? details.rows : undefined,
          truncated: details.truncated === true,
        },
      };
    }
    if (failure.fieldErrors?.file) failure.fieldErrors = { file: failure.fieldErrors.file };
    return failure;
  }

  if (dryRun) return actionSuccess(t("checkOk", { rows: result.rows }), { data: { result } });
  refresh();
  return actionSuccess(t("imported", { created: result.created }), { data: { result } });
}
