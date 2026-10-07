import "server-only";
import { getLocale, getTranslations } from "next-intl/server";
import { createErrorFormatter, type CommonTranslator, type ErrorFormatter } from "@/lib/errors";
import { translateErrors, type ValidationErrors, type ValidationTranslator } from "@/lib/validation";

/** Localised messages for backend error codes, in Server Components and Server Actions. */
export async function getErrorFormatter(): Promise<ErrorFormatter> {
  const [t, locale] = await Promise.all([getTranslations("common"), getLocale()]);
  return createErrorFormatter(t as unknown as CommonTranslator, locale);
}

/** Translates `lib/validation` keys on the server. */
export async function translateValidation(errors: ValidationErrors): Promise<Record<string, string>> {
  const t = await getTranslations("common");
  return translateErrors(errors, t as unknown as ValidationTranslator);
}
