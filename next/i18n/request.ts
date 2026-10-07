import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { APP_TIMEZONE, formats, LOCALE_COOKIE, NAMESPACES, resolveLocale, type AppLocale } from "@/i18n/config";

/**
 * next-intl request configuration, WITHOUT locale routing (URLs never contain the locale).
 * Locale: NEXT_LOCALE cookie -> Accept-Language (first of fr/en) -> fr.
 * Messages: one JSON file per namespace in messages/<locale>/, merged as { [namespace]: {...} }.
 */

async function loadMessages(locale: AppLocale) {
  const entries = await Promise.all(
    NAMESPACES.map(async (namespace) => {
      const messages = (await import(`../messages/${locale}/${namespace}.json`)).default;
      return [namespace, messages] as const;
    })
  );
  return Object.fromEntries(entries);
}

export default getRequestConfig(async ({ locale: explicitLocale }) => {
  let locale: AppLocale;
  if (explicitLocale === "fr" || explicitLocale === "en") {
    locale = explicitLocale;
  } else {
    const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
    locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value, headerList.get("accept-language"));
  }

  return {
    locale,
    messages: await loadMessages(locale),
    timeZone: APP_TIMEZONE,
    formats,
  };
});
