"use server";

import { refresh } from "next/cache";
import { getTranslations } from "next-intl/server";
import { toApiError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { zonedTimeToUtc } from "@/lib/datetime";
import { actionFailure, actionSuccess, serverApi, type ActionState } from "@/lib/server-api";
import { ROLES, type Role } from "@/lib/types";
import { formText } from "@/lib/validation";
import { manageHref } from "@/lib/announcements/paths";
import {
  BODY_MAX_LENGTH,
  hasAttachmentExtension,
  isObjectId,
  isPriority,
  MAX_ATTACHMENTS,
  MAX_FILE_MB,
  TITLE_MAX_LENGTH,
  type Announcement,
  type AudienceInput,
} from "@/lib/announcements/types";

/** Button of the composer: "Save draft", "Publish now", "Schedule", or "Save changes" (published). */
export type SaveIntent = "draft" | "publish" | "schedule" | "update";
const INTENTS: readonly SaveIntent[] = ["draft", "publish", "schedule", "update"];
/** Query parameter read by the management list to confirm what happened (?done=...). */
const DONE: Record<SaveIntent, string> = { draft: "draft", publish: "published", schedule: "scheduled", update: "updated" };

const MIN_SCHEDULE_DELAY_MS = 60_000;
const DATETIME_LOCAL_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

export type PreviewResult =
  | { ok: true; recipients: number }
  | { ok: false; reason: "GROUPS_REQUIRED" | "ROLES_NOT_ALLOWED" | "GROUP_NOT_TAUGHT" | "ERROR"; message?: string };

async function ensureManager<T = undefined>(): Promise<ActionState<T> | null> {
  const { user, error } = await requireRole(["ADMIN", "TEACHER"], manageHref);
  return user ? null : actionFailure<T>(error);
}

/** "2026-10-10T08:00" (campus wall clock, <input type="datetime-local">) -> Date, or null. */
function parsePublishAt(value: string): Date | null {
  const match = DATETIME_LOCAL_RE.exec(value.trim());
  if (!match) return null;
  const date = zonedTimeToUtc(match[1], match[2]);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readAudience(input: { roles?: unknown; programs?: unknown; levels?: unknown; groups?: unknown }): AudienceInput {
  const list = (value: unknown) => (Array.isArray(value) ? value : []);
  return {
    roles: [...new Set(list(input.roles).filter((role): role is Role => ROLES.includes(role as Role)))],
    programs: [...new Set(list(input.programs).filter(isObjectId))],
    levels: [...new Set(list(input.levels).map(Number).filter((level) => Number.isInteger(level) && level >= 1 && level <= 5))],
    groups: [...new Set(list(input.groups).filter(isObjectId))],
  };
}

const AUDIENCE_REASONS = ["GROUPS_REQUIRED", "ROLES_NOT_ALLOWED", "GROUP_NOT_TAUGHT"] as const;
type AudienceReason = (typeof AUDIENCE_REASONS)[number];

function audienceReason(details: unknown): AudienceReason | null {
  const reason = (details as { reason?: unknown } | null)?.reason;
  return AUDIENCE_REASONS.includes(reason as AudienceReason) ? (reason as AudienceReason) : null;
}

/** Turns a backend error of the composer into a localised state (field errors on the right inputs). */
async function saveFailure<T = undefined>(error: unknown, values: Record<string, string>): Promise<ActionState<T>> {
  const apiError = toApiError(error);
  const state = await actionFailure<T>(apiError, { values });
  const t = await getTranslations("announcements.form.errors");
  const details = (apiError.details ?? {}) as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};
  for (const [field, message] of Object.entries(state.fieldErrors ?? {})) {
    fieldErrors[field.startsWith("audience") ? "audience" : field] = message;
  }

  let message = state.message;
  switch (apiError.code) {
    case "AUDIENCE_NOT_ALLOWED": {
      const reason = audienceReason(details);
      message = reason ? t(`audience.${reason}`) : message;
      if (message) fieldErrors.audience = message;
      break;
    }
    case "FILE_TOO_LARGE":
      message = t("fileTooLarge", { max: MAX_FILE_MB });
      fieldErrors.attachments = message;
      break;
    case "UNSUPPORTED_FILE_TYPE":
      message = typeof details.filename === "string" ? t("fileType", { name: details.filename }) : t("fileTypeGeneric");
      fieldErrors.attachments = message;
      break;
    case "TOO_MANY_FILES":
      message = t("tooManyFiles", { max: MAX_ATTACHMENTS });
      fieldErrors.attachments = message;
      break;
    case "INVALID_STATE":
      message = t("changedMeanwhile");
      break;
    default:
      break;
  }
  return { ...state, message, fieldErrors };
}

/**
 * Composer submit (create: POST /api/announcements, edit: PATCH /api/announcements/:id).
 * Multipart (`data` JSON + `attachments`) when files are added, JSON otherwise. On success, goes back to
 * the management list (data.href: ?done=draft|published|scheduled|updated), which the page opens.
 */
export async function saveAnnouncementAction(formData: FormData): Promise<ActionState<{ href: string }>> {
  const denied = await ensureManager<{ href: string }>();
  if (denied) return denied;
  const t = await getTranslations("announcements.form.errors");

  const id = formText(formData, "id");
  const intent = formText(formData, "intent") as SaveIntent;
  const values = {
    title: formText(formData, "title").replace(/\r\n?/g, "\n").trim(),
    body: formText(formData, "body").replace(/\r\n?/g, "\n"),
    priority: formText(formData, "priority").toUpperCase() || "NORMAL",
    publishAt: formText(formData, "publishAt"),
    publishLater: formText(formData, "publishLater") === "on" ? "on" : "",
  };
  const audience = readAudience({
    roles: formData.getAll("roles"),
    programs: formData.getAll("programs"),
    levels: formData.getAll("levels"),
    groups: formData.getAll("groups"),
  });
  const removeAttachments = formData.getAll("removeAttachments").filter(isObjectId);
  const keptAttachments = Number.parseInt(formText(formData, "keptAttachments"), 10) || 0;
  const files = formData
    .getAll("attachments")
    .filter((entry): entry is File => typeof entry !== "string" && entry.size > 0 && entry.name !== "");

  const fieldErrors: Record<string, string> = {};
  if (!INTENTS.includes(intent) || (intent === "update" && !id) || (id && !isObjectId(id))) {
    return { ok: false, message: t("generic"), at: Date.now() };
  }
  if (!values.title) fieldErrors.title = t("titleRequired");
  else if (values.title.length > TITLE_MAX_LENGTH) fieldErrors.title = t("titleTooLong", { max: TITLE_MAX_LENGTH });
  if (!values.body.trim()) fieldErrors.body = t("bodyRequired");
  else if (values.body.length > BODY_MAX_LENGTH) fieldErrors.body = t("bodyTooLong", { max: BODY_MAX_LENGTH });
  if (!isPriority(values.priority)) fieldErrors.priority = t("generic");

  const publishAt = values.publishLater ? parsePublishAt(values.publishAt) : null;
  if (intent === "schedule") {
    if (!publishAt) fieldErrors.publishAt = t("publishAtRequired");
    else if (publishAt.getTime() < Date.now() + MIN_SCHEDULE_DELAY_MS) fieldErrors.publishAt = t("publishAtPast");
  }
  if (intent !== "update") {
    if (keptAttachments + files.length > MAX_ATTACHMENTS) fieldErrors.attachments = t("tooManyFiles", { max: MAX_ATTACHMENTS });
    const tooBig = files.find((file) => file.size > MAX_FILE_MB * 1024 * 1024);
    const wrongType = files.find((file) => !hasAttachmentExtension(file.name));
    if (tooBig) fieldErrors.attachments = t("fileTooLarge", { max: MAX_FILE_MB });
    if (wrongType) fieldErrors.attachments = t("fileType", { name: wrongType.name });
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, message: Object.values(fieldErrors).join(" "), fieldErrors, values, at: Date.now() };
  }

  // A published announcement only accepts title, body and priority (no new notification).
  const data: Record<string, unknown> =
    intent === "update"
      ? { title: values.title, body: values.body, priority: values.priority }
      : {
          title: values.title,
          body: values.body,
          priority: values.priority,
          audience,
          action: intent,
          publishAt: publishAt ? publishAt.toISOString() : null,
          ...(id && removeAttachments.length > 0 ? { removeAttachments } : {}),
        };

  let body: unknown = data;
  if (intent !== "update" && files.length > 0) {
    const multipart = new FormData();
    multipart.set("data", JSON.stringify(data));
    for (const file of files) multipart.append("attachments", file, file.name);
    body = multipart;
  }

  let saved: Announcement;
  try {
    saved = id
      ? await serverApi<Announcement>(`/announcements/${encodeURIComponent(id)}`, { method: "PATCH", body })
      : await serverApi<Announcement>("/announcements", { method: "POST", body });
  } catch (e) {
    return saveFailure<{ href: string }>(e, values);
  }

  const done = saved?.status === "PUBLISHED" && intent !== "update" ? DONE.publish : DONE[intent];
  const recipients = saved?.stats?.recipients;
  const query = new URLSearchParams({ done });
  if (done === DONE.publish && typeof recipients === "number") query.set("recipients", String(recipients));
  return actionSuccess<{ href: string }>(undefined, { data: { href: `${manageHref}?${query}` } });
}

/** "Publish now" of a draft / scheduled announcement: POST /api/announcements/:id/publish. */
export async function publishAnnouncementAction(id: string): Promise<ActionState> {
  const denied = await ensureManager();
  if (denied) return denied;
  const t = await getTranslations("announcements.manage");
  if (!isObjectId(id)) return actionFailure(new Error("invalid id"));

  let published: Announcement;
  try {
    published = await serverApi<Announcement>(`/announcements/${encodeURIComponent(id)}/publish`, { method: "POST" });
  } catch (e) {
    const state = await actionFailure(e);
    if (state.code === "INVALID_STATE") return { ...state, message: t("alreadyPublished") };
    if (state.code === "AUDIENCE_NOT_ALLOWED") {
      const reason = audienceReason(toApiError(e).details);
      const tErrors = await getTranslations("announcements.form.errors");
      if (reason) return { ...state, message: tErrors(`audience.${reason}`) };
    }
    return state;
  }
  refresh();
  return actionSuccess(t("done.published", { count: published?.stats?.recipients ?? 0 }));
}

/** "Confirm delete": DELETE /api/announcements/:id (files, reads and notifications go with it). */
export async function deleteAnnouncementAction(id: string, options: { backToList?: boolean } = {}): Promise<ActionState<{ href: string }>> {
  const denied = await ensureManager<{ href: string }>();
  if (denied) return denied;
  if (!isObjectId(id)) return actionFailure(new Error("invalid id"));
  try {
    await serverApi(`/announcements/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (e) {
    return actionFailure(e);
  }
  if (options.backToList) return actionSuccess<{ href: string }>(undefined, { data: { href: `${manageHref}?done=deleted` } });
  const t = await getTranslations("announcements.manage");
  refresh();
  return actionSuccess(t("done.deleted"));
}

/**
 * Live "<n> recipients" of the composer: POST /api/announcements/audience-preview. A teacher's
 * not-yet-valid audience (403 AUDIENCE_NOT_ALLOWED) comes back as a reason, shown as a hint.
 */
export async function previewAudienceAction(input: AudienceInput): Promise<PreviewResult> {
  const audience = readAudience(input ?? {});
  try {
    const result = await serverApi<{ recipients?: unknown }>("/announcements/audience-preview", {
      method: "POST",
      body: { audience },
    });
    return { ok: true, recipients: typeof result?.recipients === "number" ? result.recipients : 0 };
  } catch (e) {
    const apiError = toApiError(e);
    if (apiError.status === 401) {
      await actionFailure(apiError); // redirects to /auth/expired
    }
    const reason = apiError.code === "AUDIENCE_NOT_ALLOWED" ? audienceReason(apiError.details) : null;
    if (reason) return { ok: false, reason };
    const state = await actionFailure(apiError);
    return { ok: false, reason: "ERROR", message: state.message };
  }
}
