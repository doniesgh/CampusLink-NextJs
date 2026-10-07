// State returned by the auth Server Actions to their `useActionState` forms.
// (Kept out of the "use server" file, which may only export async functions.)

export type FieldErrors = Record<string, string>;

export type FormState = {
  /** Message for the form's role="alert" element. */
  error?: string;
  /** Message for the form's role="status" element. */
  success?: string;
  /** Backend error code of the last failure, if any. */
  code?: string;
  fieldErrors?: FieldErrors;
  /** Non-secret values to put back in the inputs after a failed submit (React resets the form). */
  values?: Record<string, string>;
  /** Changes on every response so a repeated, identical error is announced again. */
  at?: number;
};

export type LoginState = FormState & {
  step: "credentials" | "otp";
  email?: string;
  remember?: boolean;
};

export const initialFormState: FormState = {};

export const initialLoginState: LoginState = { step: "credentials" };
