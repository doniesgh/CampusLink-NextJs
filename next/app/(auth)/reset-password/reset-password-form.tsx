"use client";

import * as React from "react";
import Link from "@/components/ui/app-link";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { resetPasswordAction } from "@/app/actions/auth";
import { errorProps, FieldError, FormAlert } from "@/components/auth/form-messages";
import { PasswordInput } from "@/components/auth/password-input";
import { SubmitButton } from "@/components/auth/submit-button";
import { Label } from "@/components/ui/label";
import { initialFormState, type FieldErrors } from "@/lib/auth-state";
import { useErrorFormatter, useValidationMessages } from "@/lib/i18n/client";
import { formText, hasErrors, MIN_PASSWORD_LENGTH, summarize, validateResetPassword } from "@/lib/validation";

const linkClass = "font-semibold text-primary underline-offset-4 hover:underline";

function RequestNewLink() {
  const t = useTranslations("auth.reset");
  return (
    <p>
      <Link href="/forgot-password" className="font-semibold underline underline-offset-4">
        {t("requestNew")}
      </Link>
    </p>
  );
}

export default function ResetPasswordForm({ token }: Readonly<{ token: string }>) {
  const t = useTranslations("auth");
  const translate = useValidationMessages();
  const errorFormatter = useErrorFormatter();
  const [state, formAction, pending] = React.useActionState(resetPasswordAction, initialFormState);
  const [clientErrors, setClientErrors] = React.useState<FieldErrors | null>(null);

  const fieldErrors = clientErrors ?? state.fieldErrors ?? {};
  const error = clientErrors ? summarize(clientErrors) : state.error;
  const tokenRejected = !clientErrors && state.code === "RESET_TOKEN_INVALID";

  function onSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const errors = translate(
      validateResetPassword({
        password: formText(data, "password"),
        confirmPassword: formText(data, "confirmPassword"),
      })
    );
    if (hasErrors(errors)) {
      event.preventDefault();
      setClientErrors(errors);
    } else {
      setClientErrors(null);
    }
  }

  const header = (
    <>
      <h1 className="text-3xl font-bold tracking-tight text-foreground">{t("reset.title")}</h1>
      <p className="mt-2 text-muted-foreground">{t("reset.subtitle", { min: MIN_PASSWORD_LENGTH })}</p>
    </>
  );

  const footer = (
    <p className="mt-8 text-center text-sm">
      <Link href="/login" className={`inline-flex items-center gap-1.5 ${linkClass}`}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("reset.back")}
      </Link>
    </p>
  );

  if (!token) {
    return (
      <>
        {header}
        <FormAlert className="mt-8" message={errorFormatter.forCode("RESET_TOKEN_INVALID")}>
          <RequestNewLink />
        </FormAlert>
        {footer}
      </>
    );
  }

  return (
    <>
      {header}

      <form action={formAction} onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
        <input type="hidden" name="token" value={token} />

        <div className="space-y-2">
          <Label htmlFor="password">{t("reset.newPassword")}</Label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            placeholder={t("fields.newPasswordPlaceholder", { min: MIN_PASSWORD_LENGTH })}
            minLength={MIN_PASSWORD_LENGTH}
            required
            {...errorProps("password", fieldErrors.password)}
          />
          <FieldError id="password" message={fieldErrors.password} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">{t("fields.confirmPassword")}</Label>
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
            autoComplete="new-password"
            placeholder={t("fields.confirmPlaceholder")}
            required
            {...errorProps("confirmPassword", fieldErrors.confirmPassword)}
          />
          <FieldError id="confirmPassword" message={fieldErrors.confirmPassword} />
        </div>

        <FormAlert key={`alert-${state.at}`} message={error}>
          {tokenRejected && <RequestNewLink />}
        </FormAlert>

        <SubmitButton pending={pending}>{t("reset.submit")}</SubmitButton>
      </form>

      {footer}
    </>
  );
}
