"use client";

import { useId, useState } from "react";
import { Loader2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";

/**
 * Dialog asking for a short text before an action: "Report" (reason required), "Hide" (optional reason) and
 * "Resolve" (optional note). `onSubmit` resolves to an error message to show in the dialog, or null when done:
 * the dialog then closes and the page reports the outcome (dialogs are portals outside <main>).
 */
export function ReasonDialog({
  trigger,
  title,
  description,
  label,
  submitLabel,
  maxLength,
  validate,
  destructive = false,
  onSubmit,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: string;
  label: string;
  submitLabel: string;
  maxLength: number;
  /** Message of an invalid value (checked before sending), or null. */
  validate?: (value: string) => string | null;
  destructive?: boolean;
  onSubmit: (value: string) => Promise<string | null>;
}) {
  const tActions = useTranslations("common.actions");
  const id = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onOpenChange = (next: boolean) => {
    if (pending) return;
    setOpen(next);
    if (!next) {
      setValue("");
      setError(null);
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const invalid = validate?.(value) ?? null;
    if (invalid) {
      setError(invalid);
      return;
    }
    setPending(true);
    try {
      const failure = await onSubmit(value);
      if (failure) {
        setError(failure);
        return;
      }
      setOpen(false);
      setValue("");
      setError(null);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent {...(description ? {} : { "aria-describedby": undefined })}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form onSubmit={submit} noValidate className="grid gap-5">
          <Field id={`${id}-text`} label={label} error={error ?? undefined}>
            {(props) => (
              <Textarea
                {...props}
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  if (error) setError(null);
                }}
                maxLength={maxLength}
                rows={4}
                className="min-h-24"
              />
            )}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              {tActions("cancel")}
            </Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={pending} aria-busy={pending || undefined}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
