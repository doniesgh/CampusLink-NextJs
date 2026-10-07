// Localised messages for the backend's stable error codes (messages: common.errors.<CODE>).
// Isomorphic: use `useErrorFormatter()` (lib/i18n/client.ts) in Client Components and
// `getErrorFormatter()` (lib/i18n/server.ts) in Server Components / Server Actions.

export type ErrorLike = { code: string; details?: unknown };

/** Loose shape of next-intl's `t` for the `common` namespace (cast once where it is created). */
export type CommonTranslator = {
  (key: string, values?: Record<string, string | number | Date>): string;
  has(key: string): boolean;
};

export type ErrorFormatter = {
  /** Message for the form's/page's alert. VALIDATION_ERROR lists the field problems. */
  message(error: ErrorLike): string;
  /** Per-field messages from VALIDATION_ERROR / MISSING_FIELDS / ALREADY_EXISTS (details.field). */
  fieldErrors(error: ErrorLike): Record<string, string>;
  /** Message of one code (falls back to the generic message). */
  forCode(code: string): string;
};

export function createErrorFormatter(t: CommonTranslator, locale: string): ErrorFormatter {
  const forCode = (code: string) => {
    const key = `errors.${code}`;
    return t.has(key) ? t(key) : t("errors.GENERIC");
  };

  const fieldErrors = (error: ErrorLike): Record<string, string> => {
    const details = error.details;
    if (!details || typeof details !== "object") return {};

    if (error.code === "MISSING_FIELDS") {
      const fields = (details as { fields?: unknown }).fields;
      if (!Array.isArray(fields)) return {};
      return Object.fromEntries(
        fields.filter((f): f is string => typeof f === "string").map((f) => [f, t("validation.required")])
      );
    }

    if (error.code === "VALIDATION_ERROR") {
      // The backend writes English sentences; other languages get a generic, translated message.
      return Object.fromEntries(
        Object.entries(details as Record<string, unknown>)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string")
          .map(([field, message]) => [field, locale === "en" ? message : t("validation.invalidValue")])
      );
    }

    if (error.code === "ALREADY_EXISTS") {
      const field = (details as { field?: unknown }).field;
      return typeof field === "string" ? { [field]: forCode("ALREADY_EXISTS") } : {};
    }

    return {};
  };

  const message = (error: ErrorLike): string => {
    if (error.code === "VALIDATION_ERROR" && locale === "en") {
      const messages = Object.values(fieldErrors(error));
      if (messages.length > 0) return messages.join(" ");
    }
    return forCode(error.code);
  };

  return { message, fieldErrors, forCode };
}
