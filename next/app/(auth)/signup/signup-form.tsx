"use client";

import * as React from "react";
import Link from "next/link";
import { Mail, UserRound } from "lucide-react";
import { signupAction } from "@/app/actions/auth";
import { errorProps, FieldError, FormAlert } from "@/components/auth/form-messages";
import { PasswordInput } from "@/components/auth/password-input";
import { SsoSection } from "@/components/auth/sso-section";
import { SubmitButton } from "@/components/auth/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { initialFormState, type FieldErrors } from "@/lib/auth-state";
import { formText, hasErrors, MIN_PASSWORD_LENGTH, summarize, validateSignup } from "@/lib/validation";

const iconClass = "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground";

export default function SignupForm() {
  const [state, formAction, pending] = React.useActionState(signupAction, initialFormState);
  const [clientErrors, setClientErrors] = React.useState<FieldErrors | null>(null);

  const fieldErrors = clientErrors ?? state.fieldErrors ?? {};
  const error = clientErrors ? summarize(clientErrors) : state.error;
  const values = state.values ?? {};

  function onSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const errors = validateSignup({
      firstname: formText(data, "firstname").trim(),
      lastname: formText(data, "lastname").trim(),
      email: formText(data, "email").trim(),
      password: formText(data, "password"),
      confirmPassword: formText(data, "confirmPassword"),
    });
    if (hasErrors(errors)) {
      event.preventDefault();
      setClientErrors(errors);
    } else {
      setClientErrors(null);
    }
  }

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Create your account</h1>
      <p className="mt-2 text-muted-foreground">Join CampusLink with your school email.</p>

      <SsoSection className="mt-8" />

      <form action={formAction} onSubmit={onSubmit} className="space-y-5" noValidate>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="firstname">First name</Label>
            <div className="relative">
              <UserRound className={iconClass} aria-hidden="true" />
              <Input
                id="firstname"
                name="firstname"
                autoComplete="given-name"
                defaultValue={values.firstname ?? ""}
                required
                className="h-11 rounded-xl pl-10"
                {...errorProps("firstname", fieldErrors.firstname)}
              />
            </div>
            <FieldError id="firstname" message={fieldErrors.firstname} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="lastname">Last name</Label>
            <Input
              id="lastname"
              name="lastname"
              autoComplete="family-name"
              defaultValue={values.lastname ?? ""}
              required
              className="h-11 rounded-xl"
              {...errorProps("lastname", fieldErrors.lastname)}
            />
            <FieldError id="lastname" message={fieldErrors.lastname} />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className={iconClass} aria-hidden="true" />
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@school.edu"
              defaultValue={values.email ?? ""}
              required
              className="h-11 rounded-xl pl-10"
              {...errorProps("email", fieldErrors.email)}
            />
          </div>
          <FieldError id="email" message={fieldErrors.email} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            minLength={MIN_PASSWORD_LENGTH}
            required
            {...errorProps("password", fieldErrors.password)}
          />
          <FieldError id="password" message={fieldErrors.password} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
            autoComplete="new-password"
            placeholder="Type it again"
            required
            {...errorProps("confirmPassword", fieldErrors.confirmPassword)}
          />
          <FieldError id="confirmPassword" message={fieldErrors.confirmPassword} />
        </div>

        <FormAlert key={`alert-${state.at}`} message={error} />

        <SubmitButton pending={pending}>Create account</SubmitButton>
      </form>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-primary underline-offset-4 hover:underline">
          Log in
        </Link>
      </p>
    </>
  );
}
