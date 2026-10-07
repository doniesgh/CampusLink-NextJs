"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
import { forgotPasswordAction } from "@/app/actions/auth";
import { errorProps, FieldError, FormAlert, FormStatus } from "@/components/auth/form-messages";
import { SubmitButton } from "@/components/auth/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { initialFormState, type FieldErrors } from "@/lib/auth-state";
import { formText, hasErrors, summarize, validateForgotPassword } from "@/lib/validation";

export default function ForgotPasswordForm() {
  const [state, formAction, pending] = React.useActionState(forgotPasswordAction, initialFormState);
  const [clientErrors, setClientErrors] = React.useState<FieldErrors | null>(null);

  const fieldErrors = clientErrors ?? state.fieldErrors ?? {};
  const error = clientErrors ? summarize(clientErrors) : state.error;

  function onSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    const errors = validateForgotPassword({ email: formText(new FormData(event.currentTarget), "email").trim() });
    if (hasErrors(errors)) {
      event.preventDefault();
      setClientErrors(errors);
    } else {
      setClientErrors(null);
    }
  }

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Forgot your password?</h1>
      <p className="mt-2 text-muted-foreground">
        Enter the email of your account and we&apos;ll send you a link to choose a new password.
      </p>

      <form action={formAction} onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@school.edu"
              defaultValue={state.values?.email ?? ""}
              required
              className="h-11 rounded-xl pl-10"
              {...errorProps("email", fieldErrors.email)}
            />
          </div>
          <FieldError id="email" message={fieldErrors.email} />
        </div>

        <FormAlert key={`alert-${state.at}`} message={error} />
        {!error && <FormStatus key={`status-${state.at}`} message={state.success} />}

        <SubmitButton pending={pending}>Send reset link</SubmitButton>
      </form>

      <p className="mt-8 text-center text-sm">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 font-semibold text-primary underline-offset-4 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to log in
        </Link>
      </p>
    </>
  );
}
