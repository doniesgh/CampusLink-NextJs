"use client";

import { useCallback, useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { createErrorFormatter, type CommonTranslator, type ErrorFormatter } from "@/lib/errors";
import { translateErrors, type ValidationErrors, type ValidationTranslator } from "@/lib/validation";

/** Localised messages for backend error codes, in Client Components. */
export function useErrorFormatter(): ErrorFormatter {
  const t = useTranslations("common");
  const locale = useLocale();
  return useMemo(() => createErrorFormatter(t as unknown as CommonTranslator, locale), [t, locale]);
}

/** Translates `lib/validation` keys in Client Components: `translate(validateLogin(values))`. */
export function useValidationMessages(): (errors: ValidationErrors) => Record<string, string> {
  const t = useTranslations("common");
  return useCallback((errors: ValidationErrors) => translateErrors(errors, t as unknown as ValidationTranslator), [t]);
}
