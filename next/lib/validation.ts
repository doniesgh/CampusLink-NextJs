// Form validation shared by the auth forms (run in the browser first, then again in the Server Action).

import type { FieldErrors } from "@/lib/auth-state";

export const MIN_PASSWORD_LENGTH = 8;

export const PASSWORD_TOO_SHORT = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
export const PASSWORDS_DONT_MATCH = "Passwords don't match.";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

function checkEmail(email: string, errors: FieldErrors): void {
  if (!email) errors.email = "Enter your email.";
  else if (!isValidEmail(email)) errors.email = "Enter a valid email address.";
}

function checkNewPassword(password: string, confirmPassword: string, errors: FieldErrors): void {
  if (password.length < MIN_PASSWORD_LENGTH) errors.password = PASSWORD_TOO_SHORT;
  if (password !== confirmPassword) errors.confirmPassword = PASSWORDS_DONT_MATCH;
}

export function validateLogin(values: { email: string; password: string }): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.email) errors.email = "Enter your email.";
  if (!values.password) errors.password = "Enter your password.";
  return errors;
}

export function validateSignup(values: {
  firstname: string;
  lastname: string;
  email: string;
  password: string;
  confirmPassword: string;
}): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.firstname) errors.firstname = "Enter your first name.";
  if (!values.lastname) errors.lastname = "Enter your last name.";
  checkEmail(values.email, errors);
  checkNewPassword(values.password, values.confirmPassword, errors);
  return errors;
}

export function validateForgotPassword(values: { email: string }): FieldErrors {
  const errors: FieldErrors = {};
  checkEmail(values.email, errors);
  return errors;
}

export function validateResetPassword(values: { password: string; confirmPassword: string }): FieldErrors {
  const errors: FieldErrors = {};
  checkNewPassword(values.password, values.confirmPassword, errors);
  return errors;
}

/** One sentence per problem, for the form's alert. */
export function summarize(errors: FieldErrors): string {
  return Object.values(errors).join(" ");
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Reads a FormData entry as a string ("" when missing or a file). */
export function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
