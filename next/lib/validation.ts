// Form validation shared by the auth/account forms (run in the browser first, then again in the
// Server Action). Validators return message KEYS of `common.validation` (see messages/<locale>/common.json);
// translate them with `translateErrors()`.

export const MIN_PASSWORD_LENGTH = 8;

export type ValidationKey =
  | "required"
  | "emailRequired"
  | "emailInvalid"
  | "passwordRequired"
  | "passwordTooShort"
  | "passwordsDontMatch"
  | "firstnameRequired"
  | "lastnameRequired"
  | "otpRequired"
  | "invalidValue";

/** field name -> validation key */
export type ValidationErrors = Record<string, ValidationKey>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

function checkEmail(email: string, errors: ValidationErrors): void {
  if (!email) errors.email = "emailRequired";
  else if (!isValidEmail(email)) errors.email = "emailInvalid";
}

function checkNewPassword(
  password: string,
  confirmPassword: string,
  errors: ValidationErrors,
  fields: { password: string; confirm: string } = { password: "password", confirm: "confirmPassword" }
): void {
  if (password.length < MIN_PASSWORD_LENGTH) errors[fields.password] = "passwordTooShort";
  if (password !== confirmPassword) errors[fields.confirm] = "passwordsDontMatch";
}

export function validateLogin(values: { email: string; password: string }): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!values.email) errors.email = "emailRequired";
  if (!values.password) errors.password = "passwordRequired";
  return errors;
}

export function validateSignup(values: {
  firstname: string;
  lastname: string;
  email: string;
  password: string;
  confirmPassword: string;
}): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!values.firstname) errors.firstname = "firstnameRequired";
  if (!values.lastname) errors.lastname = "lastnameRequired";
  checkEmail(values.email, errors);
  checkNewPassword(values.password, values.confirmPassword, errors);
  return errors;
}

export function validateForgotPassword(values: { email: string }): ValidationErrors {
  const errors: ValidationErrors = {};
  checkEmail(values.email, errors);
  return errors;
}

export function validateResetPassword(values: { password: string; confirmPassword: string }): ValidationErrors {
  const errors: ValidationErrors = {};
  checkNewPassword(values.password, values.confirmPassword, errors);
  return errors;
}

export function validateChangePassword(values: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!values.currentPassword) errors.currentPassword = "passwordRequired";
  checkNewPassword(values.newPassword, values.confirmPassword, errors, { password: "newPassword", confirm: "confirmPassword" });
  return errors;
}

export function validateProfile(values: { firstname: string; lastname: string }): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!values.firstname) errors.firstname = "firstnameRequired";
  if (!values.lastname) errors.lastname = "lastnameRequired";
  return errors;
}

/** Minimal translator shape: next-intl's `t` for the `common` namespace (client or server). */
export type ValidationTranslator = (key: `validation.${ValidationKey}`, values?: { min: number }) => string;

/** Translates validation keys into messages ({ field: "Enter your email." }). */
export function translateErrors(errors: ValidationErrors, t: ValidationTranslator): Record<string, string> {
  return Object.fromEntries(
    Object.entries(errors).map(([field, key]) => [field, t(`validation.${key}`, { min: MIN_PASSWORD_LENGTH })])
  );
}

/** One sentence per problem, for the form's alert. */
export function summarize(errors: Record<string, string>): string {
  return Object.values(errors).join(" ");
}

export function hasErrors(errors: Record<string, unknown>): boolean {
  return Object.keys(errors).length > 0;
}

/** Reads a FormData entry as a string ("" when missing or a file). */
export function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
