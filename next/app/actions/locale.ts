"use server";

import { cookies, headers } from "next/headers";
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "@/i18n/config";
import { api } from "@/lib/api";
import { ACCESS_COOKIE, secureCookies } from "@/lib/session";

/**
 * Language switcher: stores the locale in the NEXT_LOCALE cookie (which re-renders the current
 * page in that language) and, when signed in, saves it on the account (PATCH /api/users/me { locale })
 * so emails and push notifications use it too.
 */
export async function setLocaleAction(locale: string): Promise<{ ok: boolean }> {
  if (!isLocale(locale)) return { ok: false };

  const jar = await cookies();
  jar.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    secure: secureCookies(),
    httpOnly: false,
  });

  const token = jar.get(ACCESS_COOKIE)?.value;
  if (token) {
    try {
      await api("/api/users/me", { method: "PATCH", body: { locale }, token, forward: await headers() });
    } catch {
      // Best effort: the cookie already switched the interface; the account keeps its previous value.
    }
  }
  return { ok: true };
}
