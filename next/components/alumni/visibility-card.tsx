"use client";

import { useState } from "react";
import { Globe, Loader2, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { VisibilityBadge } from "@/components/alumni/badges";
import { useAlumniFormat } from "@/components/alumni/use-alumni-format";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { InlineFeedback, type Feedback } from "@/components/ui/feedback";
import { useErrorFormatter } from "@/lib/i18n/client";
import { useOnlineStatus } from "@/lib/offline";
import type { AlumniProfile } from "@/lib/alumni/types";
import { cn } from "@/lib/utils";
import { setVisibilityAction } from "@/app/(back)/dashboard/alumni/actions";

/**
 * "Visibility and consent" (GDPR): a profile is PRIVATE until its owner explicitly agrees to show it to the campus
 * (checkbox + "Make my profile visible": the server records the date of the consent). "Make my profile private"
 * withdraws the consent at any time. The e-mail address is never part of the profile.
 */
export function VisibilityCard({
  profile,
  onChanged,
  feedback,
  report,
}: {
  profile: AlumniProfile;
  onChanged: (profile: AlumniProfile) => void;
  /** Outcome of the last visibility action (one feedback region per tab, shown where the action was made). */
  feedback: Feedback | null;
  report: (feedback: Feedback) => void;
}) {
  const t = useTranslations("alumni.visibility");
  const errors = useErrorFormatter();
  const online = useOnlineStatus();
  const format = useAlumniFormat();
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const visible = profile.visibility === "CAMPUS" && !!profile.consentAt;

  const change = async (visibility: "CAMPUS" | "PRIVATE") => {
    if (visibility === "CAMPUS" && !consent) {
      setConsentError(t("consentMissing"));
      document.getElementById("alumni-consent")?.focus();
      return;
    }
    setPending(true);
    try {
      const result = await setVisibilityAction(visibility, visibility === "CAMPUS" && consent);
      if (result.ok && result.data) {
        setConsent(false);
        setConsentError(null);
        onChanged(result.data);
        report({ type: "success", message: result.message ?? "" });
      } else if (result.fieldErrors?.consent) {
        setConsentError(result.fieldErrors.consent);
      } else {
        report({ type: "error", message: result.message ?? errors.forCode("GENERIC") });
      }
    } catch {
      report({ type: "error", message: errors.forCode("NETWORK_ERROR") });
    } finally {
      setPending(false);
    }
  };

  const Icon = visible ? Globe : Lock;

  return (
    <section
      aria-labelledby="alumni-visibility-title"
      className={cn("space-y-4 rounded-3xl border p-4 sm:p-6", visible ? "border-success/30 bg-card" : "border-primary/20 bg-card")}
      data-testid="visibility-card"
      data-visibility={visible ? "CAMPUS" : "PRIVATE"}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl",
              visible ? "bg-success/10 text-success" : "bg-accent text-primary"
            )}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 id="alumni-visibility-title" className="text-lg font-semibold text-foreground">
              {t("title")}
            </h2>
            <p className="text-sm font-medium text-foreground">{t(visible ? "visibleStatus" : "privateStatus")}</p>
          </div>
        </div>
        <VisibilityBadge visibility={visible ? "CAMPUS" : "PRIVATE"} />
      </div>

      {visible ? (
        <>
          <p className="text-sm text-muted-foreground">
            {t("visibleText", { date: format.date(profile.consentAt) ?? "" })}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">{t("withdrawHint")}</p>
            <Button
              type="button"
              variant="outline"
              className="shrink-0 rounded-full"
              disabled={pending || !online}
              aria-busy={pending || undefined}
              onClick={() => void change("PRIVATE")}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
              {t("makePrivate")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t("privateText")}</p>
          <div className="rounded-2xl bg-muted/60 p-4">
            <CheckboxField
              id="alumni-consent"
              label={t("consentLabel")}
              description={consentError ? undefined : t("consentHint")}
              checked={consent}
              onChange={(event) => {
                setConsent(event.target.checked);
                if (consentError) setConsentError(null);
              }}
              {...(consentError ? { "aria-invalid": true, "aria-describedby": "alumni-consent-error" } : {})}
            />
            {consentError && (
              <p id="alumni-consent-error" className="mt-2 pl-7 text-sm text-destructive">
                {consentError}
              </p>
            )}
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              className="w-full rounded-full sm:w-auto"
              disabled={pending || !online}
              aria-busy={pending || undefined}
              onClick={() => void change("CAMPUS")}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Globe className="h-4 w-4" aria-hidden="true" />}
              {t("makeVisible")}
            </Button>
          </div>
        </>
      )}
      <InlineFeedback feedback={feedback} />
    </section>
  );
}
