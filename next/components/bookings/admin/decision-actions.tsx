"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  adminCancelBookingAction,
  approveBookingAction,
  rejectBookingAction,
  type DecisionState,
} from "@/app/(back)/dashboard/admin/bookings/actions";
import { useBookingFormat } from "@/components/bookings/use-booking-format";
import { SubmitButton } from "@/components/auth/submit-button";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { InlineFeedback, type Feedback } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { NOTE_MAX } from "@/lib/bookings/rules";
import { bookingResourceName, personName, type Booking } from "@/lib/bookings/types";

/** Outcome of a decision for the page's feedback (dialogs are portals: the result is shown in <main>). */
export function toFeedback(state: DecisionState): Feedback | null {
  return state.message ? { type: state.ok ? "success" : "error", message: state.message, at: state.at } : null;
}

/**
 * "Approve" (optional note) or "Reject" (reason required) of a PENDING request, in a dialog. Stale versions
 * and handled requests close the dialog and are reported in the page (the list is rendered again).
 */
export function DecisionDialog({
  booking,
  mode,
  onDone,
  size = "sm",
}: {
  booking: Booking;
  mode: "approve" | "reject";
  onDone: (feedback: Feedback | null) => void;
  size?: "sm" | "default";
}) {
  const t = useTranslations("bookings.admin.decision");
  const fmt = useBookingFormat();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [state, setState] = useState<DecisionState | null>(null);
  const [pending, startTransition] = useTransition();
  const approve = mode === "approve";
  const fieldId = `decision-${mode}-${booking.id}`;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!approve && !note.trim()) {
      const message = t("reasonRequired");
      setState({ ok: false, message, fieldErrors: { note: message }, at: Date.now() });
      return;
    }
    startTransition(async () => {
      const result = approve
        ? await approveBookingAction(booking.id, booking.version, note)
        : await rejectBookingAction(booking.id, booking.version, note);
      if (result.ok || result.data?.reload) {
        setOpen(false);
        setState(null);
        setNote("");
        onDone(toFeedback(result));
        return;
      }
      setState(result);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (pending) return;
        setOpen(value);
        if (!value) setState(null);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant={approve ? "default" : "outline"}
          size={size}
          className={approve ? "rounded-full" : "rounded-full text-destructive hover:text-destructive"}
          aria-label={approve ? t("approveLabel", { resource: bookingResourceName(booking) }) : t("rejectLabel", { resource: bookingResourceName(booking) })}
        >
          {approve ? <Check className="h-4 w-4" aria-hidden="true" /> : <X className="h-4 w-4" aria-hidden="true" />}
          {approve ? t("approve") : t("reject")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{approve ? t("approveTitle") : t("rejectTitle")}</DialogTitle>
          <DialogDescription>
            {t("summary", { resource: bookingResourceName(booking), when: fmt.when(booking.startsAt, booking.endsAt), name: personName(booking.user) })}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <p className="whitespace-pre-line break-words rounded-2xl bg-muted px-3 py-2 text-sm">{booking.purpose}</p>
          <Field
            id={fieldId}
            label={approve ? t("noteLabel") : t("reasonLabel")}
            hint={approve ? t("noteHint", { max: NOTE_MAX }) : t("reasonHint", { max: NOTE_MAX })}
            error={state?.ok === false ? state.fieldErrors?.note : undefined}
          >
            {(props) => (
              <Textarea {...props} rows={3} maxLength={NOTE_MAX} value={note} required={!approve} onChange={(event) => setNote(event.target.value)} />
            )}
          </Field>
          <InlineFeedback feedback={state && !state.ok && state.message ? { type: "error", message: state.message, at: state.at } : null} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="rounded-full" onClick={() => setOpen(false)} disabled={pending}>
              {t("back")}
            </Button>
            <SubmitButton pending={pending} variant={approve ? "default" : "destructive"} className="h-10 w-full rounded-full px-6 shadow-none sm:w-auto">
              {approve ? t("confirmApprove") : t("confirmReject")}
            </SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Cancel booking" (admin, any PENDING / CONFIRMED booking): confirmation, then the owner is notified. */
export function AdminCancelButton({ booking, onDone }: { booking: Booking; onDone: (feedback: Feedback | null) => void }) {
  const t = useTranslations("bookings.admin.decision");
  const fmt = useBookingFormat();
  return (
    <ConfirmDialog
      trigger={
        <Button
          variant="outline"
          size="sm"
          className="rounded-full"
          aria-label={t("cancelLabel", { resource: bookingResourceName(booking), name: personName(booking.user) })}
        >
          {t("cancel")}
        </Button>
      }
      title={t("cancelTitle", { name: personName(booking.user) })}
      description={t("cancelDescription", { resource: bookingResourceName(booking), when: fmt.when(booking.startsAt, booking.endsAt) })}
      confirmLabel={t("confirmCancel")}
      cancelLabel={t("back")}
      onConfirm={async () => {
        const result = await adminCancelBookingAction(booking.id, booking.version);
        onDone(toFeedback(result));
      }}
    />
  );
}
