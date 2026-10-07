"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { api, toApiError, type ApiError } from "@/lib/api";
import { fieldErrorsFrom, messageForCode, messageForError } from "@/lib/auth-messages";
import type { FormState, LoginState } from "@/lib/auth-state";
import { safeNextPath } from "@/lib/safe-next";
import { clearSessionCookies, REFRESH_COOKIE, setSessionCookies } from "@/lib/session";
import type { OtpChallenge, Session } from "@/lib/types";
import {
  formText,
  hasErrors,
  summarize,
  validateForgotPassword,
  validateLogin,
  validateResetPassword,
  validateSignup,
} from "@/lib/validation";

const FORGOT_PASSWORD_SENT = "If an account exists for this email, we've sent a reset link.";

function failure(error: ApiError, extra: Partial<FormState> = {}): FormState {
  return {
    error: messageForError(error),
    code: error.code,
    fieldErrors: fieldErrorsFrom(error),
    at: Date.now(),
    ...extra,
  };
}

function isOtpChallenge(body: Session | OtpChallenge): body is OtpChallenge {
  return (body as OtpChallenge).otpRequired === true;
}

/**
 * Login form, both steps:
 * - no `intent`: email + password -> session, or an OTP challenge when 2FA is on
 * - intent=verify: email + 6-digit code -> session
 * - intent=restart: back to the email/password step
 */
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const intent = formText(formData, "intent");
  const email = formText(formData, "email").trim();
  const remember = ["on", "1", "true"].includes(formText(formData, "remember"));
  const next = safeNextPath(formText(formData, "next")) ?? "/dashboard";

  if (intent === "restart") {
    return { step: "credentials", email, remember, values: { email } };
  }

  let session: Session;

  if (intent === "verify") {
    const otp = formText(formData, "otp").replace(/\s+/g, "");
    if (!email) {
      return { step: "credentials", error: "Your verification session has expired. Please log in again.", at: Date.now() };
    }
    if (!otp) {
      return {
        step: "otp",
        email,
        remember,
        error: "Enter the 6-digit code we emailed you.",
        fieldErrors: { otp: "Enter the 6-digit code we emailed you." },
        at: Date.now(),
      };
    }
    try {
      session = await api<Session>("/api/auth/verify-otp", { body: { email, otp } });
    } catch (e) {
      const error = toApiError(e);
      if (error.code === "OTP_TOO_MANY_ATTEMPTS") {
        // The pending code was cleared by the backend: start over.
        return { step: "credentials", email, remember, values: { email }, ...failure(error) };
      }
      return { step: "otp", email, remember, ...failure(error) };
    }
  } else {
    const password = formText(formData, "password");
    const errors = validateLogin({ email, password });
    if (hasErrors(errors)) {
      return { step: "credentials", email, remember, values: { email }, error: summarize(errors), fieldErrors: errors, at: Date.now() };
    }

    let body: Session | OtpChallenge;
    try {
      body = await api<Session | OtpChallenge>("/api/auth/login", { body: { email, password } });
    } catch (e) {
      return { step: "credentials", email, remember, values: { email }, ...failure(toApiError(e)) };
    }

    if (isOtpChallenge(body)) {
      return { step: "otp", email: body.email || email, remember };
    }
    session = body;
  }

  setSessionCookies(await cookies(), session, remember);
  redirect(next);
}

export async function signupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = {
    firstname: formText(formData, "firstname").trim(),
    lastname: formText(formData, "lastname").trim(),
    email: formText(formData, "email").trim(),
  };
  const password = formText(formData, "password");
  const confirmPassword = formText(formData, "confirmPassword");

  const errors = validateSignup({ ...values, password, confirmPassword });
  if (hasErrors(errors)) {
    return { error: summarize(errors), fieldErrors: errors, values, at: Date.now() };
  }

  let session: Session;
  try {
    // The backend always creates a STUDENT account on public signup.
    session = await api<Session>("/api/auth/signup", { body: { ...values, password } });
  } catch (e) {
    return failure(toApiError(e), { values });
  }

  setSessionCookies(await cookies(), session, true);
  redirect("/dashboard");
}

export async function forgotPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = formText(formData, "email").trim();
  const errors = validateForgotPassword({ email });
  if (hasErrors(errors)) {
    return { error: summarize(errors), fieldErrors: errors, values: { email }, at: Date.now() };
  }

  try {
    await api<{ message: string }>("/api/auth/forgot-password", { body: { email } });
  } catch (e) {
    return failure(toApiError(e), { values: { email } });
  }

  // Same answer whether or not the account exists (no account enumeration).
  return { success: FORGOT_PASSWORD_SENT, values: { email }, at: Date.now() };
}

export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = formText(formData, "token");
  const password = formText(formData, "password");
  const confirmPassword = formText(formData, "confirmPassword");

  if (!token) {
    return { error: messageForCode("RESET_TOKEN_INVALID"), code: "RESET_TOKEN_INVALID", at: Date.now() };
  }
  const errors = validateResetPassword({ password, confirmPassword });
  if (hasErrors(errors)) {
    return { error: summarize(errors), fieldErrors: errors, at: Date.now() };
  }

  try {
    await api<{ message: string }>("/api/auth/reset-password", { body: { token, password } });
  } catch (e) {
    return failure(toApiError(e));
  }

  // The backend revoked every refresh token of this user: drop any session held by this browser too.
  clearSessionCookies(await cookies());
  redirect("/login?reset=1");
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    try {
      await api<void>("/api/auth/logout", { body: { refreshToken } });
    } catch {
      // Best effort: the local session is cleared either way.
    }
  }
  clearSessionCookies(jar);
  redirect("/login");
}
