// Friendly English messages for the backend's stable error codes.

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: "Incorrect email or password.",
  EMAIL_TAKEN: "An account already exists with this email.",
  OTP_INVALID: "That code is invalid or has expired.",
  OTP_TOO_MANY_ATTEMPTS: "Too many attempts. Please log in again.",
  RESET_TOKEN_INVALID: "This reset link is invalid or has expired.",
  NETWORK_ERROR: "Can't reach the server. Please try again.",
  MISSING_FIELDS: "Please fill in all required fields.",
  VALIDATION_ERROR: "Please check the highlighted fields.",
  EMAIL_FAILED: "We couldn't send the email. Please try again in a moment.",
  INVALID_PASSWORD: "Your current password is incorrect.",
  INVALID_REFRESH_TOKEN: "Your session has expired. Please log in again.",
  TOKEN_EXPIRED: "Your session has expired. Please log in again.",
  INVALID_TOKEN: "Your session has expired. Please log in again.",
  AUTH_REQUIRED: "Please log in to continue.",
  FORBIDDEN: "You don't have access to this page.",
  TOO_MANY_REQUESTS: "Too many requests. Please wait a moment and try again.",
};

export const GENERIC_ERROR = "Something went wrong. Please try again.";

export type ErrorLike = { code: string; details?: unknown };

export function messageForCode(code: string): string {
  return MESSAGES[code] ?? GENERIC_ERROR;
}

/**
 * Field errors from a VALIDATION_ERROR (`details = { field: message }`) or the
 * list of missing fields of a MISSING_FIELDS error (`details.fields = [...]`).
 */
export function fieldErrorsFrom(error: ErrorLike): Record<string, string> {
  const details = error.details;
  if (!details || typeof details !== "object") return {};

  if (error.code === "MISSING_FIELDS") {
    const fields = (details as { fields?: unknown }).fields;
    if (!Array.isArray(fields)) return {};
    return Object.fromEntries(
      fields.filter((f): f is string => typeof f === "string").map((f) => [f, "This field is required."])
    );
  }

  if (error.code === "VALIDATION_ERROR") {
    return Object.fromEntries(
      Object.entries(details as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    );
  }

  return {};
}

/** Message shown in the form's alert. VALIDATION_ERROR shows its details. */
export function messageForError(error: ErrorLike): string {
  if (error.code === "VALIDATION_ERROR") {
    const messages = Object.values(fieldErrorsFrom(error));
    if (messages.length > 0) return messages.join(" ");
  }
  return messageForCode(error.code);
}
