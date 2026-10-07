"use client";

import * as React from "react";
import Link from "next/link";
import { KeyRound, Mail } from "lucide-react";
import { loginAction } from "@/app/actions/auth";
import { errorProps, FieldError, FormAlert, FormStatus } from "@/components/auth/form-messages";
import { PasswordInput } from "@/components/auth/password-input";
import { SsoSection } from "@/components/auth/sso-section";
import { SubmitButton } from "@/components/auth/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { initialLoginState, type FieldErrors } from "@/lib/auth-state";
import { formText, hasErrors, summarize, validateLogin } from "@/lib/validation";

const linkClass = "font-semibold text-primary underline-offset-4 hover:underline";

export default function LoginForm({ next, reset }: Readonly<{ next: string; reset: boolean }>) {
  const [state, formAction, pending] = React.useActionState(loginAction, initialLoginState);
  const [clientErrors, setClientErrors] = React.useState<FieldErrors | null>(null);

  const fieldErrors = clientErrors ?? state.fieldErrors ?? {};
  const error = clientErrors ? summarize(clientErrors) : state.error;

  function onSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const errors = validateLogin({ email: formText(data, "email").trim(), password: formText(data, "password") });
    if (hasErrors(errors)) {
      event.preventDefault();
      setClientErrors(errors);
    } else {
      setClientErrors(null);
    }
  }

  if (state.step === "otp") {
    return (
      <>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Log in</h1>
        <p className="mt-2 text-muted-foreground">
          We emailed a 6-digit verification code to{" "}
          <span className="font-medium text-foreground">{state.email}</span>. It expires in 10 minutes.
        </p>

        <form action={formAction} className="mt-8 space-y-5" noValidate>
          <input type="hidden" name="email" value={state.email ?? ""} />
          <input type="hidden" name="remember" value={state.remember ? "1" : "0"} />
          <input type="hidden" name="next" value={next} />

          <div className="space-y-2">
            <Label htmlFor="otp">Verification code</Label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                id="otp"
                name="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                autoFocus
                required
                className="h-11 rounded-xl pl-10 tracking-[0.3em]"
                {...errorProps("otp", state.fieldErrors?.otp)}
              />
            </div>
            <FieldError id="otp" message={state.fieldErrors?.otp} />
          </div>

          <FormAlert key={`alert-${state.at}`} message={state.error} />

          {/* Both buttons carry the intent: the first one is also the default for "Enter". */}
          <SubmitButton name="intent" value="verify" pending={pending}>
            Verify
          </SubmitButton>
          <button
            type="submit"
            name="intent"
            value="restart"
            disabled={pending}
            className="w-full text-center text-sm font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50"
          >
            Use a different account
          </button>
        </form>
      </>
    );
  }

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Log in</h1>
      <p className="mt-2 text-muted-foreground">Enter your details to open your CampusLink account.</p>

      {reset && <FormStatus className="mt-6" message="Your password has been reset. You can log in now." />}

      <SsoSection className="mt-8" />

      <form action={formAction} onSubmit={onSubmit} className="space-y-5" noValidate>
        <input type="hidden" name="next" value={next} />

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
              defaultValue={state.values?.email ?? state.email ?? ""}
              required
              className="h-11 rounded-xl pl-10"
              {...errorProps("email", fieldErrors.email)}
            />
          </div>
          <FieldError id="email" message={fieldErrors.email} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link href="/forgot-password" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="current-password"
            placeholder="Your password"
            required
            {...errorProps("password", fieldErrors.password)}
          />
          <FieldError id="password" message={fieldErrors.password} />
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            name="remember"
            defaultChecked={state.remember ?? false}
            className="h-4 w-4 rounded border-input accent-primary"
          />
          Keep me signed in
        </label>

        <FormAlert key={`alert-${state.at}`} message={error} />

        <SubmitButton pending={pending}>Log in</SubmitButton>
      </form>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        New to CampusLink?{" "}
        <Link href="/signup" className={linkClass}>
          Create an account
        </Link>
      </p>
    </>
  );
}
