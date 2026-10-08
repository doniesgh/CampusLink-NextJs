"use server";

import { refresh } from "next/cache";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/dal";
import { translateValidation } from "@/lib/i18n/server";
import { actionFailure, actionSuccess, serverApi, type ActionState } from "@/lib/server-api";
import { ROOM_TYPES, type RoomType } from "@/lib/types";
import { formText, hasErrors, summarize, type ValidationErrors } from "@/lib/validation";

export type AcademicResource = "programs" | "groups" | "subjects" | "rooms";
const RESOURCES: readonly AcademicResource[] = ["programs", "groups", "subjects", "rooms"];
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const ACADEMIC_YEAR_RE = /^(\d{4})-(\d{4})$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

async function ensureAdmin(): Promise<ActionState | null> {
  const { user, error } = await requireRole(["ADMIN"], "/dashboard/admin/academic");
  return user ? null : actionFailure(error);
}

function isResource(value: string): value is AcademicResource {
  return (RESOURCES as readonly string[]).includes(value);
}

/** Reads and checks the dialog's fields; returns the API body or validation keys. */
function readBody(resource: AcademicResource, formData: FormData): { body: Record<string, unknown>; errors: ValidationErrors; values: Record<string, string> } {
  const text = (name: string) => formText(formData, name).trim();
  const errors: ValidationErrors = {};
  const values: Record<string, string> = {};
  const body: Record<string, unknown> = {};

  const name = text("name");
  values.name = name;
  if (!name) errors.name = "required";
  body.name = name;

  if (resource === "programs" || resource === "subjects") {
    const code = text("code").toUpperCase();
    values.code = code;
    if (!code) errors.code = "required";
    body.code = code;
  }
  if (resource === "programs") {
    values.description = text("description");
    body.description = values.description;
  }
  if (resource === "subjects") {
    const color = text("color");
    values.color = color;
    if (color) {
      if (COLOR_RE.test(color)) body.color = color.toUpperCase();
      else errors.color = "invalidValue";
    }
  }
  if (resource === "groups") {
    const program = text("program");
    const level = Number.parseInt(text("level"), 10);
    const academicYear = text("academicYear");
    Object.assign(values, { program, level: text("level"), academicYear });
    if (!OBJECT_ID_RE.test(program)) errors.program = "required";
    if (!Number.isInteger(level) || level < 1 || level > 5) errors.level = "invalidValue";
    const year = ACADEMIC_YEAR_RE.exec(academicYear);
    if (!year || Number(year[2]) !== Number(year[1]) + 1) errors.academicYear = "invalidValue";
    Object.assign(body, { program, level, academicYear });
  }
  if (resource === "rooms") {
    const building = text("building");
    const capacityText = text("capacity");
    const type = text("type");
    Object.assign(values, { building, capacity: capacityText, type });
    body.building = building;
    if (capacityText) {
      const capacity = Number(capacityText);
      if (!Number.isInteger(capacity) || capacity < 0) errors.capacity = "invalidValue";
      else body.capacity = capacity;
    }
    if (!ROOM_TYPES.includes(type as RoomType)) errors.type = "invalidValue";
    body.type = type;
    // Booking fields (Module 5): sent as booleans when the dialog has the checkboxes.
    if (formData.get("bookingFields") === "1") {
      body.bookable = formData.get("bookable") === "on";
      body.requiresApproval = formData.get("requiresApproval") === "on";
      Object.assign(values, { bookable: body.bookable ? "on" : "off", requiresApproval: body.requiresApproval ? "on" : "off" });
    }
  }
  return { body, errors, values };
}

/** Add / edit dialog of the Academic structure tabs. */
export async function saveAcademicAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const denied = await ensureAdmin();
  if (denied) return denied;

  const resource = formText(formData, "resource");
  const id = formText(formData, "id");
  if (!isResource(resource) || (id && !OBJECT_ID_RE.test(id))) return actionFailure(new Error("invalid resource"));

  const { body, errors, values } = readBody(resource, formData);
  const messages = await translateValidation(errors);
  if (hasErrors(messages)) return { ok: false, message: summarize(messages), fieldErrors: messages, values, at: Date.now() };

  try {
    await serverApi(`/academic/${resource}${id ? `/${id}` : ""}`, { method: id ? "PATCH" : "POST", body });
  } catch (e) {
    return actionFailure(e, { values });
  }
  const t = await getTranslations("admin.academic");
  refresh();
  return actionSuccess(t("saved", { name: String(body.name) }));
}

/** "Confirm delete". IN_USE (409) comes back as a failed state with code "IN_USE". */
export async function deleteAcademicAction(resource: string, id: string, name: string): Promise<ActionState> {
  const denied = await ensureAdmin();
  if (denied) return denied;
  if (!isResource(resource) || !OBJECT_ID_RE.test(id)) return actionFailure(new Error("invalid resource"));

  const t = await getTranslations("admin.academic");
  try {
    await serverApi(`/academic/${resource}/${id}`, { method: "DELETE" });
  } catch (e) {
    const failure = await actionFailure(e);
    if (failure.code === "IN_USE") failure.message = t("inUse", { name });
    return failure;
  }
  refresh();
  return actionSuccess(t("deleted", { name }));
}
