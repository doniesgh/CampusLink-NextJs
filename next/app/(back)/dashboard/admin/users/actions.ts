"use server";

import { refresh } from "next/cache";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/dal";
import { translateValidation } from "@/lib/i18n/server";
import { actionFailure, actionSuccess, serverApi, type ActionState } from "@/lib/server-api";
import { ROLES, type Role, type User } from "@/lib/types";
import { formText, hasErrors, isValidEmail, MIN_PASSWORD_LENGTH, summarize, type ValidationErrors } from "@/lib/validation";

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

async function ensureAdmin(): Promise<ActionState | null> {
  const { user, error } = await requireRole(["ADMIN"], "/dashboard/admin/users");
  return user ? null : actionFailure(error);
}

/** "Save" of the Add user / Edit dialog: POST /api/users or PATCH /api/users/:id. */
export async function saveUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const denied = await ensureAdmin();
  if (denied) return denied;

  const id = formText(formData, "id");
  const values = {
    firstname: formText(formData, "firstname").trim(),
    lastname: formText(formData, "lastname").trim(),
    email: formText(formData, "email").trim(),
    role: formText(formData, "role").trim().toUpperCase(),
    group: formText(formData, "group").trim(),
  };
  const password = formText(formData, "password");

  const errors: ValidationErrors = {};
  if (!values.firstname) errors.firstname = "firstnameRequired";
  if (!values.lastname) errors.lastname = "lastnameRequired";
  if (!values.email) errors.email = "emailRequired";
  else if (!isValidEmail(values.email)) errors.email = "emailInvalid";
  if (!ROLES.includes(values.role as Role)) errors.role = "invalidValue";
  if (!id && password.length < MIN_PASSWORD_LENGTH) errors.password = "passwordTooShort";
  if (id && password && password.length < MIN_PASSWORD_LENGTH) errors.password = "passwordTooShort";
  if (values.group && !OBJECT_ID_RE.test(values.group)) errors.group = "invalidValue";
  const messages = await translateValidation(errors);
  if (hasErrors(messages)) return { ok: false, message: summarize(messages), fieldErrors: messages, values, at: Date.now() };

  const body: Record<string, unknown> = {
    firstname: values.firstname,
    lastname: values.lastname,
    email: values.email,
    role: values.role,
  };
  if (password) body.password = password;
  // Only students belong to a group; the backend clears it when the role changes.
  if (values.role === "STUDENT") body.group = values.group || null;

  let saved: User;
  try {
    saved = id
      ? await serverApi<User>(`/users/${encodeURIComponent(id)}`, { method: "PATCH", body })
      : await serverApi<User>("/users", { method: "POST", body });
  } catch (e) {
    return actionFailure(e, { values });
  }

  const t = await getTranslations("admin.users");
  const name = `${saved.firstname} ${saved.lastname}`;
  refresh();
  return actionSuccess(id ? t("updated", { name }) : t("created", { name }));
}

/** "Confirm delete": DELETE /api/users/:id. */
export async function deleteUserAction(id: string, name: string): Promise<ActionState> {
  const denied = await ensureAdmin();
  if (denied) return denied;
  if (!OBJECT_ID_RE.test(id)) return actionFailure(new Error("invalid id"));

  try {
    await serverApi(`/users/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (e) {
    return actionFailure(e);
  }
  const t = await getTranslations("admin.users");
  refresh();
  return actionSuccess(t("deleted", { name }));
}
