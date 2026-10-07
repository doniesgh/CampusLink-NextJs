"use client";

import { useActionState, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { SubmitButton } from "@/components/auth/submit-button";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { InlineFeedback, type Feedback } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PasswordInput } from "@/components/auth/password-input";
import { useValidationMessages } from "@/lib/i18n/client";
import { resyncPushSubscription } from "@/lib/offline/push";
import type { ActionState } from "@/lib/server-api";
import type { Role } from "@/lib/types";
import { formText, hasErrors, summarize, validateChangePassword, validateProfile } from "@/lib/validation";
import { changePasswordAction, setTwoFactorAction, updateProfileAction } from "./actions";
import { PushToggle } from "./push-toggle";

type Section = "profile" | "language" | "security" | "password" | "push";
type SectionFeedback = (Feedback & { section: Section }) | null;

export type AccountUser = {
  firstname: string;
  lastname: string;
  email: string;
  role: Role;
  twoFactorEnabled: boolean;
  group: string | null;
};

const initialState: ActionState = {};

/** Account page: Profile, Language, Security (2FA + password), Notifications (push). */
export function AccountView({ user, vapidPublicKey }: { user: AccountUser; vapidPublicKey: string | null }) {
  const t = useTranslations("account");
  const tRoles = useTranslations("common.roles");
  const translate = useValidationMessages();

  // One message at a time on the page (status or alert), shown in the section it belongs to.
  const [feedback, setFeedbackState] = useState<SectionFeedback>(null);
  const [languageSaved, setLanguageSaved] = useState(false);
  const show = (section: Section, value: Feedback | null) => {
    setLanguageSaved(false);
    setFeedbackState(value ? { ...value, section, at: Date.now() } : null);
  };
  const feedbackFor = (section: Section) => (feedback?.section === section ? feedback : null);

  // --- Profile ---
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});
  const [, profileAction, profilePending] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await updateProfileAction(prev, formData);
    setProfileErrors(result.fieldErrors ?? {});
    show("profile", result.message ? { type: result.ok ? "success" : "error", message: result.message } : null);
    return result;
  }, initialState);

  const validateProfileForm = (event: React.SubmitEvent<HTMLFormElement>) => {
    const data = new FormData(event.currentTarget);
    const errors = translate(validateProfile({ firstname: formText(data, "firstname").trim(), lastname: formText(data, "lastname").trim() }));
    if (hasErrors(errors)) {
      event.preventDefault();
      setProfileErrors(errors);
      show("profile", { type: "error", message: summarize(errors) });
    }
  };

  // --- Two-step verification ---
  const [twoFactor, setTwoFactor] = useState(user.twoFactorEnabled);
  const [twoFactorPending, startTwoFactor] = useTransition();
  const toggleTwoFactor = (enabled: boolean) => {
    const previous = twoFactor;
    setTwoFactor(enabled);
    startTwoFactor(async () => {
      const result = await setTwoFactorAction(enabled);
      if (!result.ok) setTwoFactor(previous);
      else if (result.data) setTwoFactor(result.data.enabled);
      show("security", result.message ? { type: result.ok ? "success" : "error", message: result.message } : null);
    });
  };

  // --- Password ---
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const [passwordFormKey, setPasswordFormKey] = useState(0);
  const [, passwordAction, passwordPending] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await changePasswordAction(prev, formData);
    setPasswordErrors(result.fieldErrors ?? {});
    if (result.ok) {
      setPasswordFormKey((key) => key + 1);
      // The backend dropped this user's push subscriptions with the old sessions: the new session takes this
      // browser's subscription back, so notifications keep arriving and the push toggle stays truthful.
      void resyncPushSubscription();
    }
    show("password", result.message ? { type: result.ok ? "success" : "error", message: result.message } : null);
    return result;
  }, initialState);

  const validatePasswordForm = (event: React.SubmitEvent<HTMLFormElement>) => {
    const data = new FormData(event.currentTarget);
    const errors = translate(
      validateChangePassword({
        currentPassword: formText(data, "currentPassword"),
        newPassword: formText(data, "newPassword"),
        confirmPassword: formText(data, "confirmPassword"),
      })
    );
    if (hasErrors(errors)) {
      event.preventDefault();
      setPasswordErrors(errors);
      show("password", { type: "error", message: summarize(errors) });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("profile.title")}</CardTitle>
          <CardDescription>
            {user.email} · {tRoles(user.role)}
            {user.role === "STUDENT" && ` · ${t("profile.groupValue", { group: user.group ?? t("profile.noGroup") })}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={profileAction} onSubmit={validateProfileForm} className="space-y-5" noValidate>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="profile-firstname" label={t("profile.firstname")} error={profileErrors.firstname}>
                {(props) => <Input {...props} name="firstname" autoComplete="given-name" defaultValue={user.firstname} required />}
              </Field>
              <Field id="profile-lastname" label={t("profile.lastname")} error={profileErrors.lastname}>
                {(props) => <Input {...props} name="lastname" autoComplete="family-name" defaultValue={user.lastname} required />}
              </Field>
            </div>
            <InlineFeedback feedback={feedbackFor("profile")} />
            <SubmitButton pending={profilePending} className="h-10 w-auto rounded-full px-6 shadow-none">
              {t("profile.save")}
            </SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("language.title")}</CardTitle>
          <CardDescription>{t("language.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <LanguageSwitcher
            className="flex-col items-start gap-2"
            selectClassName="h-10 w-56 rounded-xl"
            onChanged={() => {
              show("language", null);
              setLanguageSaved(true);
            }}
          />
          {/* Computed at render time so it shows in the newly selected language. */}
          <InlineFeedback feedback={languageSaved ? { type: "success", message: t("language.saved") } : null} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("security.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-8">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4 rounded-2xl bg-muted p-4">
              <div>
                <label htmlFor="two-factor" className="cursor-pointer font-medium">
                  {t("security.twoFactor")}
                </label>
                <p id="two-factor-description" className="mt-1 text-sm text-muted-foreground">
                  {t("security.twoFactorDescription")}
                </p>
              </div>
              <Switch
                id="two-factor"
                checked={twoFactor}
                onCheckedChange={toggleTwoFactor}
                disabled={twoFactorPending}
                aria-describedby="two-factor-description"
              />
            </div>
            <InlineFeedback feedback={feedbackFor("security")} />
          </div>

          <form
            key={passwordFormKey}
            action={passwordAction}
            onSubmit={validatePasswordForm}
            className="space-y-5"
            noValidate
          >
            <h3 className="font-semibold">{t("security.passwordTitle")}</h3>
            <Field id="currentPassword" label={t("security.currentPassword")} error={passwordErrors.currentPassword}>
              {(props) => <PasswordInput {...props} name="currentPassword" autoComplete="current-password" required />}
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="newPassword" label={t("security.newPassword")} error={passwordErrors.newPassword}>
                {(props) => <PasswordInput {...props} name="newPassword" autoComplete="new-password" required />}
              </Field>
              <Field id="confirmPassword" label={t("security.confirmPassword")} error={passwordErrors.confirmPassword}>
                {(props) => <PasswordInput {...props} name="confirmPassword" autoComplete="new-password" required />}
              </Field>
            </div>
            <InlineFeedback feedback={feedbackFor("password")} />
            <SubmitButton pending={passwordPending} className="h-10 w-auto rounded-full px-6 shadow-none">
              {t("security.changePassword")}
            </SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("push.title")}</CardTitle>
          <CardDescription>{t("push.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <PushToggle vapidPublicKey={vapidPublicKey} onFeedback={(value) => show("push", value)} />
          <InlineFeedback feedback={feedbackFor("push")} />
        </CardContent>
      </Card>
    </div>
  );
}
