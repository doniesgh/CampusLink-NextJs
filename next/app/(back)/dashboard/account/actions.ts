"use server";

import { refresh } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { api } from "@/lib/api";
import { translateValidation } from "@/lib/i18n/server";
import { actionFailure, actionSuccess, serverApi, type ActionState } from "@/lib/server-api";
import { clearSessionCookies, REMEMBER_COOKIE, setSessionCookies } from "@/lib/session";
import type { OtpChallenge, Session, User } from "@/lib/types";
import { formText, hasErrors, summarize, validateChangePassword, validateProfile } from "@/lib/validation";

/** "Save profile": PATCH /api/users/me { firstname, lastname }. */
export async function updateProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = { firstname: formText(formData, "firstname").trim(), lastname: formText(formData, "lastname").trim() };
  const errors = await translateValidation(validateProfile(values));
  if (hasErrors(errors)) return { ok: false, message: summarize(errors), fieldErrors: errors, values, at: Date.now() };

  try {
    await serverApi<User>("/users/me", { method: "PATCH", body: values });
  } catch (e) {
    return actionFailure(e, { values });
  }
  const t = await getTranslations("account.profile");
  refresh();
  return actionSuccess(t("saved"), { values });
}

/** "Two-step verification" switch: PATCH /api/users/me { twoFactorEnabled }. */
export async function setTwoFactorAction(enabled: boolean): Promise<ActionState<{ enabled: boolean }>> {
  try {
    const user = await serverApi<User>("/users/me", { method: "PATCH", body: { twoFactorEnabled: enabled === true } });
    const t = await getTranslations("account.security");
    refresh();
    return actionSuccess(user.twoFactorEnabled ? t("twoFactorEnabled") : t("twoFactorDisabled"), {
      data: { enabled: user.twoFactorEnabled },
    });
  } catch (e) {
    return actionFailure(e);
  }
}

/**
 * "Change password": POST /api/auth/change-password. The backend signs out every device (all refresh
 * tokens revoked), so this browser signs in again with the new password to stay connected. With
 * two-step verification that would need an emailed code: the user is sent to the login page instead.
 */
export async function changePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const currentPassword = formText(formData, "currentPassword");
  const newPassword = formText(formData, "newPassword");
  const confirmPassword = formText(formData, "confirmPassword");

  const errors = await translateValidation(validateChangePassword({ currentPassword, newPassword, confirmPassword }));
  if (hasErrors(errors)) return { ok: false, message: summarize(errors), fieldErrors: errors, at: Date.now() };

  let me: User;
  try {
    me = await serverApi<User>("/users/me");
    await serverApi("/auth/change-password", { method: "POST", body: { currentPassword, newPassword } });
  } catch (e) {
    const failure = await actionFailure(e);
    if (failure.code === "INVALID_PASSWORD") failure.fieldErrors = { ...failure.fieldErrors, currentPassword: failure.message ?? "" };
    return failure;
  }

  const jar = await cookies();
  let relogged = false;
  try {
    const body = await api<Session | OtpChallenge>("/api/auth/login", {
      body: { email: me.email, password: newPassword },
      forward: await headers(),
    });
    if (!(body as OtpChallenge).otpRequired) {
      setSessionCookies(jar, body as Session, jar.get(REMEMBER_COOKIE)?.value === "1");
      relogged = true;
    }
  } catch {
    // Rate limit or network failure: the user logs in again below.
  }

  if (!relogged) {
    // Session over: the /login answer also wipes the offline data of this browser (cl_ended, proxy.ts).
    clearSessionCookies(jar);
    redirect("/login?changed=1");
  }
  const t = await getTranslations("account.security");
  return actionSuccess(t("passwordChanged"));
}
