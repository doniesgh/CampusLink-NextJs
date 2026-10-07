"use client";

import * as React from "react";
import Link from "@/components/ui/app-link";
import { KeyRound, Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { loginAction } from "@/app/actions/auth";
import { errorProps, FieldError, FormAlert, FormStatus } from "@/components/auth/form-messages";
import { PasswordInput } from "@/components/auth/password-input";
import { SsoSection } from "@/components/auth/sso-section";
import { SubmitButton } from "@/components/auth/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { initialLoginState, type FieldErrors } from "@/lib/auth-state";
import { useValidationMessages } from "@/lib/i18n/client";
import { formText, hasErrors, summarize, validateLogin } from "@/lib/validation";

const linkClass = "font-semibold text-primary underline-offset-4 hover:underline";

export default function LoginForm({
  next,
  notice,
}: Readonly<{ next: string; notice: "reset" | "passwordChanged" | null }>) {
  const t = useTranslations("auth");
  const translate = useValidationMessages();
  const [state, formAction, pending] = React.useActionState(loginAction, initialLoginState);
  const [clientErrors, setClientErrors] = React.useState<FieldErrors | null>(null);

  const fieldErrors = clientErrors ?? state.fieldErrors ?? {};
  const error = clientErrors ? summarize(clientErrors) : state.error;

  function onSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const errors = translate(validateLogin({ email: formText(data, "email").trim(), password: formText(data, "password") }));
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
        <h1 className="text-3xl font-bold tracking-tight text-foreground">{t("login.title")}</h1>
        <p className="mt-2 text-muted-foreground">
          {t.rich("login.otpIntro", {
            email: state.email ?? "",
            strong: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
          })}
        </p>

        <form action={formAction} className="mt-8 space-y-5" noValidate>
          <input type="hidden" name="email" value={state.email ?? ""} />
          <input type="hidden" name="remember" value={state.remember ? "1" : "0"} />
          <input type="hidden" name="next" value={next} />

          <div className="space-y-2">
            <Label htmlFor="otp">{t("login.otpLabel")}</Label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                id="otp"
                name="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder={t("login.otpPlaceholder")}
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
            {t("login.verify")}
          </SubmitButton>
          <button
            type="submit"
            name="intent"
            value="restart"
            disabled={pending}
            className="w-full rounded-xl py-2 text-center text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {t("login.differentAccount")}
          </button>
        </form>
      </>
    );
  }

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight text-foreground">{t("login.title")}</h1>
      <p className="mt-2 text-muted-foreground">{t("login.subtitle")}</p>

      {notice === "reset" && <FormStatus className="mt-6" message={t("login.resetDone")} />}
      {notice === "passwordChanged" && <FormStatus className="mt-6" message={t("login.passwordChanged")} />}

      <SsoSection className="mt-8" />

      <form action={formAction} onSubmit={onSubmit} className="space-y-5" noValidate>
        <input type="hidden" name="next" value={next} />

        <div className="space-y-2">
          <Label htmlFor="email">{t("fields.email")}</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder={t("fields.emailPlaceholder")}
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
            <Label htmlFor="password">{t("fields.password")}</Label>
            <Link href="/forgot-password" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              {t("login.forgot")}
            </Link>
          </div>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="current-password"
            placeholder={t("fields.passwordPlaceholder")}
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
          {t("login.remember")}
        </label>

        <FormAlert key={`alert-${state.at}`} message={error} />

        <SubmitButton pending={pending}>{t("login.submit")}</SubmitButton>
      </form>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        {t("login.newHere")}{" "}
        <Link href="/signup" className={linkClass}>
          {t("login.createAccount")}
        </Link>
      </p>
    </>
  );
}
