"use client";

import { useState } from "react";
import { Check, Mail, Undo2, X, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { AlumniAvatar } from "@/components/alumni/alumni-avatar";
import { AlumniText } from "@/components/alumni/alumni-text";
import { RequestStatusBadge } from "@/components/alumni/badges";
import { TextDialog } from "@/components/alumni/text-dialog";
import { useAlumniFormat, useDisplayName } from "@/components/alumni/use-alumni-format";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import Link from "@/components/ui/app-link";
import { Button } from "@/components/ui/button";
import type { Feedback } from "@/components/ui/feedback";
import { useErrorFormatter } from "@/lib/i18n/client";
import { useOnlineStatus } from "@/lib/offline";
import { profileHref } from "@/lib/alumni/paths";
import { REPLY_MAX_LENGTH, type MentoringRequest, type MentoringRole } from "@/lib/alumni/types";
import { validateReply } from "@/lib/alumni/validation";
import { cn } from "@/lib/utils";
import { closeMentoringAction, respondMentoringAction } from "@/app/(back)/dashboard/alumni/actions";

const ACTION_BUTTON = "h-9 rounded-full px-3";

/** A labelled block of the card ("Your message", "Selim's reply"...). */
function Block({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl bg-muted/60 px-4 py-3", className)}>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/**
 * One mentoring request, seen by the student (`side="mentee"`) or by the alumni (`side="mentor"`): the other person,
 * the status, the topic, the message, the reply, the contact e-mails (only once ACCEPTED) and the actions:
 * "Accept" / "Decline" with an optional reply (mentor, PENDING), "Withdraw request" (mentee, PENDING) and
 * "End mentoring" (either side, ACCEPTED). Outcomes go to `report` (one feedback region per list).
 */
export function MentoringCard({
  request,
  side,
  onChanged,
  report,
  headingLevel = "h3",
}: {
  request: MentoringRequest;
  side: MentoringRole;
  onChanged: (request: MentoringRequest, previous: MentoringRequest) => void;
  report: (feedback: Feedback) => void;
  headingLevel?: "h2" | "h3";
}) {
  const t = useTranslations("alumni.mentoring");
  const tValidation = useTranslations("alumni.validation");
  const errors = useErrorFormatter();
  const online = useOnlineStatus();
  const format = useAlumniFormat();
  const displayName = useDisplayName();
  const [busy, setBusy] = useState(false);

  const other = side === "mentee" ? request.mentor : request.mentee;
  const otherName = displayName(other);
  const otherFirst = other?.firstname || otherName;
  const otherProfile = side === "mentee" ? request.mentor?.profileId : null;
  const Heading = headingLevel;
  const email = side === "mentee" ? request.contact?.mentorEmail : request.contact?.menteeEmail;

  const run = async (action: () => ReturnType<typeof closeMentoringAction>): Promise<string | null> => {
    setBusy(true);
    try {
      const result = await action();
      if (!result.ok) {
        // Already answered or closed meanwhile: show the current state (the server answers 409 / 404).
        return result.fieldErrors?.reply ?? result.message ?? errors.forCode("GENERIC");
      }
      if (result.data) onChanged(result.data, request);
      report({ type: "success", message: result.message ?? "" });
      return null;
    } catch {
      return errors.forCode("NETWORK_ERROR");
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    const failure = await run(() => closeMentoringAction(request.id));
    if (failure) report({ type: "error", message: failure });
  };

  const replyDialog = (decision: "accept" | "decline") => (
    <TextDialog
      trigger={
        <Button
          type="button"
          variant={decision === "accept" ? "default" : "outline"}
          size="sm"
          className={ACTION_BUTTON}
          disabled={busy || !online}
        >
          {decision === "accept" ? <Check className="h-4 w-4" aria-hidden="true" /> : <X className="h-4 w-4" aria-hidden="true" />}
          {t(decision === "accept" ? "accept" : "decline")}
        </Button>
      }
      title={t(decision === "accept" ? "acceptTitle" : "declineTitle", { name: otherName })}
      description={t(decision === "accept" ? "acceptDescription" : "declineDescription", { name: otherFirst })}
      label={t("replyLabel")}
      hint={t(decision === "accept" ? "acceptReplyHint" : "declineReplyHint")}
      submitLabel={t(decision === "accept" ? "acceptSubmit" : "declineSubmit")}
      maxLength={REPLY_MAX_LENGTH}
      validate={(value) => {
        const invalid = validateReply(value);
        return invalid ? tValidation(invalid.key, invalid.values) : null;
      }}
      onSubmit={(reply) => run(() => respondMentoringAction(request.id, decision, reply))}
    />
  );

  const closedLine = () => {
    const date = format.date(request.closedAt) ?? "";
    if (request.closedBy === "SYSTEM") return t("closedBySystem", { date });
    const byMe = (request.closedBy === "MENTOR" && side === "mentor") || (request.closedBy === "MENTEE" && side === "mentee");
    return byMe ? t("closedByYou", { date }) : t("closedByOther", { name: otherFirst, date });
  };

  return (
    <article className="rounded-2xl border bg-card p-4 text-card-foreground sm:p-5" data-request-id={request.id} data-status={request.status}>
      <header className="flex items-start gap-3">
        <AlumniAvatar user={other} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{t(side === "mentee" ? "toLabel" : "fromLabel")}</p>
          <p className="break-words text-sm font-semibold text-foreground">
            {otherProfile ? (
              <Link
                href={profileHref(otherProfile)}
                className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {otherName}
              </Link>
            ) : (
              otherName
            )}
          </p>
        </div>
        <RequestStatusBadge status={request.status} />
      </header>

      <Heading className="mt-3 break-words text-base font-semibold leading-snug text-foreground">{request.topic}</Heading>
      <p className="text-xs text-muted-foreground">
        {t("sentOn", { date: format.dateTime(request.createdAt) ?? "" })}
      </p>

      <div className="mt-3 space-y-2">
        <Block label={t(side === "mentee" ? "yourMessage" : "theirMessage", { name: otherFirst })}>
          {request.message ? (
            <AlumniText text={request.message} testId="request-message" />
          ) : (
            <p className="text-sm italic text-muted-foreground">{t("messageRemoved")}</p>
          )}
        </Block>
        {request.reply && (
          <Block label={t(side === "mentor" ? "yourReply" : "theirReply", { name: otherFirst })}>
            <AlumniText text={request.reply} testId="request-reply" />
          </Block>
        )}
        {request.status === "ACCEPTED" && email && (
          <div className="rounded-2xl border border-success/30 bg-success/10 px-4 py-3 text-sm" data-testid="request-contact">
            <p className="font-semibold text-success">{t("contactTitle")}</p>
            <p className="mt-1 text-foreground">{t(side === "mentee" ? "contactMentee" : "contactMentor", { name: otherFirst })}</p>
            <a
              href={`mailto:${email}`}
              className="mt-1 inline-flex max-w-full items-center gap-1.5 break-all rounded-sm font-semibold text-primary underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
              {email}
            </a>
          </div>
        )}
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        {request.status === "PENDING" && (side === "mentee" ? t("waitingMentee", { name: otherFirst }) : t("waitingMentor"))}
        {request.status === "ACCEPTED" && t("acceptedOn", { date: format.date(request.respondedAt) ?? "" })}
        {request.status === "DECLINED" && t("declinedOn", { date: format.date(request.respondedAt) ?? "" })}
        {request.status === "CLOSED" && closedLine()}
      </p>

      {(request.status === "PENDING" || request.status === "ACCEPTED") && (
        <div className="mt-3 flex flex-wrap justify-end gap-2" role="group" aria-label={t("actionsLabel", { topic: request.topic })}>
          {request.status === "PENDING" && side === "mentor" && (
            <>
              {replyDialog("decline")}
              {replyDialog("accept")}
            </>
          )}
          {request.status === "PENDING" && side === "mentee" && (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="outline" size="sm" className={ACTION_BUTTON} disabled={busy || !online}>
                  <Undo2 className="h-4 w-4" aria-hidden="true" />
                  {t("withdraw")}
                </Button>
              }
              title={t("withdrawTitle")}
              description={t("withdrawText", { name: otherFirst })}
              confirmLabel={t("withdrawConfirm")}
              onConfirm={close}
            />
          )}
          {request.status === "ACCEPTED" && (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="outline" size="sm" className={ACTION_BUTTON} disabled={busy || !online}>
                  <XCircle className="h-4 w-4" aria-hidden="true" />
                  {t("end")}
                </Button>
              }
              title={t("endTitle")}
              description={t("endText", { name: otherFirst })}
              confirmLabel={t("endConfirm")}
              onConfirm={close}
            />
          )}
        </div>
      )}
    </article>
  );
}
