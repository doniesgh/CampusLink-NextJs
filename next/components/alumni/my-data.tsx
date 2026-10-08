"use client";

import { useState } from "react";
import { Download, Loader2, ShieldAlert, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { InlineFeedback, type Feedback } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { useErrorFormatter } from "@/lib/i18n/client";
import { useOnlineStatus } from "@/lib/offline";
import { EXPORT_HREF } from "@/lib/alumni/paths";
import { isEraseConfirmation } from "@/lib/alumni/validation";
import { eraseMyDataAction } from "@/app/(back)/dashboard/alumni/actions";

const ERASE_EFFECTS = ["profile", "posts", "requests", "history", "account"] as const;

/**
 * "My data" (GDPR): "Download my data" (a JSON file: profile, posts, mentoring requests sent and received; a plain
 * link to the BFF, which passes the attachment through) and "Delete my data" (right to be forgotten), behind a strong
 * confirmation: the user types a word (DELETE / SUPPRIMER) before the button unlocks.
 */
export function MyData({
  onErased,
  report,
  feedback,
}: {
  onErased: (message: string) => void;
  report: (feedback: Feedback) => void;
  /** Outcome of the last action of this tab (one feedback region). */
  feedback: Feedback | null;
}) {
  const t = useTranslations("alumni.data");
  const tActions = useTranslations("common.actions");
  const errors = useErrorFormatter();
  const online = useOnlineStatus();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const word = t("confirmWord");
  const matches = isEraseConfirmation(typed, word);

  const onOpenChange = (next: boolean) => {
    if (pending) return;
    setOpen(next);
    if (!next) {
      setTyped("");
      setError(null);
    }
  };

  const erase = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!matches) {
      setError(t("confirmMismatch", { word }));
      return;
    }
    setPending(true);
    try {
      const result = await eraseMyDataAction(typed);
      if (!result.ok) {
        setError(result.fieldErrors?.confirmation ?? result.message ?? errors.forCode("GENERIC"));
        return;
      }
      setOpen(false);
      setTyped("");
      setError(null);
      onErased(result.message ?? t("erased"));
    } catch {
      setError(errors.forCode("NETWORK_ERROR"));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-5">
      <section aria-labelledby="alumni-export-title" className="space-y-3 rounded-3xl border bg-card p-4 text-card-foreground sm:p-6">
        <h2 id="alumni-export-title" className="text-lg font-semibold text-foreground">
          {t("exportTitle")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("exportText")}</p>
        {online ? (
          <Button asChild variant="outline" className="rounded-full">
            <a
              href={EXPORT_HREF}
              download
              data-testid="alumni-export"
              onClick={() => report({ type: "info", message: t("exportStarted") })}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {t("exportButton")}
            </a>
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" className="rounded-full" disabled>
              <Download className="h-4 w-4" aria-hidden="true" />
              {t("exportButton")}
            </Button>
            <p className="text-sm text-muted-foreground">{t("offline")}</p>
          </>
        )}
      </section>

      <InlineFeedback feedback={feedback} />

      <section aria-labelledby="alumni-erase-title" className="space-y-3 rounded-3xl border border-destructive/30 bg-card p-4 text-card-foreground sm:p-6">
        <h2 id="alumni-erase-title" className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <ShieldAlert className="h-5 w-5 text-destructive" aria-hidden="true" />
          {t("eraseTitle")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("eraseIntro")}</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
          {ERASE_EFFECTS.map((effect) => (
            <li key={effect}>{t(`effects.${effect}`)}</li>
          ))}
        </ul>
        <p className="text-sm font-semibold text-destructive">{t("irreversible")}</p>
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogTrigger asChild>
            <Button type="button" variant="destructive" className="rounded-full" disabled={!online}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {t("eraseButton")}
            </Button>
          </DialogTrigger>
          <DialogContent role="alertdialog">
            <DialogHeader>
              <DialogTitle>{t("dialogTitle")}</DialogTitle>
              <DialogDescription>{t("dialogText")}</DialogDescription>
            </DialogHeader>
            <form onSubmit={erase} noValidate className="grid gap-5">
              <Field id="alumni-erase-confirm" label={t("confirmLabel", { word })} error={error ?? undefined}>
                {(props) => (
                  <Input
                    {...props}
                    value={typed}
                    onChange={(event) => {
                      setTyped(event.target.value);
                      if (error) setError(null);
                    }}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                  />
                )}
              </Field>
              <DialogFooter>
                <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
                  {tActions("cancel")}
                </Button>
                <Button type="submit" variant="destructive" disabled={pending || !matches} aria-busy={pending || undefined}>
                  {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {t("confirmButton")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        {!online && <p className="text-sm text-muted-foreground">{t("offline")}</p>}
      </section>
    </div>
  );
}
