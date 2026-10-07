"use server";

import { after } from "next/server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import {
  isLocale,
  localeFromAcceptLanguage,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  type AppLocale,
} from "@/i18n/config";
import { api, toApiError, type ApiError } from "@/lib/api";
import type { FormState, LoginState } from "@/lib/auth-state";
import { getErrorFormatter, translateValidation } from "@/lib/i18n/server";
import { safeNextPath } from "@/lib/safe-next";
import { clearSessionCookies, REFRESH_COOKIE, secureCookies, setSessionCookies } from "@/lib/session";
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

async function failure(error: ApiError, extra: Partial<FormState> = {}): Promise<FormState> {
  const formatter = await getErrorFormatter();
  return {
    error: formatter.message(error),
    code: error.code,
    fieldErrors: formatter.fieldErrors(error),
    at: Date.now(),
    ...extra,
  };
}

function isOtpChallenge(body: Session | OtpChallenge): body is OtpChallenge {
  return (body as OtpChallenge).otpRequired === true;
}

type CookieStore = Awaited<ReturnType<typeof cookies>>;

function setLocaleCookie(jar: CookieStore, locale: AppLocale): void {
  jar.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    secure: secureCookies(),
    httpOnly: false,
  });
}

/**
 * After login the interface keeps the language the user is looking at (NEXT_LOCALE cookie, else the
 * browser's Accept-Language); only when neither names fr/en does the account's saved locale apply.
 * The result is stored in the cookie and saved to `user.locale` (emails and push use it).
 */
async function syncLocaleAfterLogin(jar: CookieStore, session: Session): Promise<void> {
  const headerList = await headers();
  const cookieLocale = jar.get(LOCALE_COOKIE)?.value;
  const locale: AppLocale = isLocale(cookieLocale)
    ? cookieLocale
    : (localeFromAcceptLanguage(headerList.get("accept-language")) ?? (isLocale(session.user.locale) ? session.user.locale : "fr"));

  setLocaleCookie(jar, locale);
  if (session.user.locale !== locale) {
    const forward = new Headers(headerList);
    after(async () => {
      try {
        await api("/api/users/me", { method: "PATCH", body: { locale }, token: session.accessToken, forward });
      } catch {
        // Best effort.
      }
    });
  }
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
  const forward = await headers();

  if (intent === "restart") {
    return { step: "credentials", email, remember, values: { email } };
  }

  let session: Session;

  if (intent === "verify") {
    const t = await getTranslations("auth.login");
    const otp = formText(formData, "otp").replace(/\s+/g, "");
    if (!email) {
      return { step: "credentials", error: t("otpSessionExpired"), at: Date.now() };
    }
    if (!otp) {
      const message = (await translateValidation({ otp: "otpRequired" })).otp;
      return { step: "otp", email, remember, error: message, fieldErrors: { otp: message }, at: Date.now() };
    }
    try {
      session = await api<Session>("/api/auth/verify-otp", { body: { email, otp }, forward });
    } catch (e) {
      const error = toApiError(e);
      if (error.code === "OTP_TOO_MANY_ATTEMPTS") {
        // The pending code was cleared by the backend: start over.
        return { step: "credentials", email, remember, values: { email }, ...(await failure(error)) };
      }
      return { step: "otp", email, remember, ...(await failure(error)) };
    }
  } else {
    const password = formText(formData, "password");
    const errors = await translateValidation(validateLogin({ email, password }));
    if (hasErrors(errors)) {
      return { step: "credentials", email, remember, values: { email }, error: summarize(errors), fieldErrors: errors, at: Date.now() };
    }

    let body: Session | OtpChallenge;
    try {
      body = await api<Session | OtpChallenge>("/api/auth/login", { body: { email, password }, forward });
    } catch (e) {
      return { step: "credentials", email, remember, values: { email }, ...(await failure(toApiError(e))) };
    }

    if (isOtpChallenge(body)) {
      return { step: "otp", email: body.email || email, remember };
    }
    session = body;
  }

  const jar = await cookies();
  setSessionCookies(jar, session, remember);
  await syncLocaleAfterLogin(jar, session);
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

  const errors = await translateValidation(validateSignup({ ...values, password, confirmPassword }));
  if (hasErrors(errors)) {
    return { error: summarize(errors), fieldErrors: errors, values, at: Date.now() };
  }

  // The account is created in the language the visitor is using.
  const locale = (await getLocale()) as AppLocale;
  let session: Session;
  try {
    // The backend always creates a STUDENT account on public signup.
    session = await api<Session>("/api/auth/signup", { body: { ...values, password, locale }, forward: await headers() });
  } catch (e) {
    return failure(toApiError(e), { values });
  }

  const jar = await cookies();
  setSessionCookies(jar, session, true);
  setLocaleCookie(jar, locale);
  redirect("/dashboard");
}

export async function forgotPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = formText(formData, "email").trim();
  const errors = await translateValidation(validateForgotPassword({ email }));
  if (hasErrors(errors)) {
    return { error: summarize(errors), fieldErrors: errors, values: { email }, at: Date.now() };
  }

  try {
    await api<{ message: string }>("/api/auth/forgot-password", { body: { email }, forward: await headers() });
  } catch (e) {
    return failure(toApiError(e), { values: { email } });
  }

  // Same answer whether or not the account exists (no account enumeration).
  const t = await getTranslations("auth.forgot");
  return { success: t("sent"), values: { email }, at: Date.now() };
}

export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = formText(formData, "token");
  const password = formText(formData, "password");
  const confirmPassword = formText(formData, "confirmPassword");

  if (!token) {
    const formatter = await getErrorFormatter();
    return { error: formatter.forCode("RESET_TOKEN_INVALID"), code: "RESET_TOKEN_INVALID", at: Date.now() };
  }
  const errors = await translateValidation(validateResetPassword({ password, confirmPassword }));
  if (hasErrors(errors)) {
    return { error: summarize(errors), fieldErrors: errors, at: Date.now() };
  }

  try {
    await api<{ message: string }>("/api/auth/reset-password", { body: { token, password }, forward: await headers() });
  } catch (e) {
    return failure(toApiError(e));
  }

  // The backend revoked every refresh token of this user: drop any session held by this browser too
  // (and, through cl_ended, the offline data it left: see clearSessionCookies).
  clearSessionCookies(await cookies());
  redirect("/login?reset=1");
}

/**
 * Ends the session on the backend and clears the cookies. The client-side part of logout
 * (IndexedDB, Cache Storage, push subscription) runs before, in <LogoutButton>. clearSessionCookies() also
 * sets cl_ended, so the /login answer this redirect leads to carries `Clear-Site-Data: "cache", "storage"`
 * (proxy.ts; Next.js copies it onto this action's answer), in case the client-side cleanup did not finish.
 */
export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    try {
      await api<void>("/api/auth/logout", { body: { refreshToken }, forward: await headers() });
    } catch {
      // Best effort: the local session is cleared either way.
    }
  }
  clearSessionCookies(jar);
  redirect("/login");
}
