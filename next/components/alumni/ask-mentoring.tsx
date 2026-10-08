"use client";

import { useState } from "react";
import { Handshake, Loader2, Send, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { MentoringCard } from "@/components/alumni/mentoring-card";
import { MentoringRules } from "@/components/alumni/mentoring-rules";
import Link from "@/components/ui/app-link";
import { Button } from "@/components/ui/button";
import { InlineFeedback, type Feedback } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useErrorFormatter } from "@/lib/i18n/client";
import { invalidateQueries, useOnlineStatus } from "@/lib/offline";
import { alumniPageHref } from "@/lib/alumni/paths";
import {
  MAX_PENDING_PER_STUDENT,
  MESSAGE_MAX_LENGTH,
  MESSAGE_MIN_LENGTH,
  TOPIC_MAX_LENGTH,
  type MentoringRequest,
  type ProfileDetail,
} from "@/lib/alumni/types";
import { hasValidationErrors, normalizeText, validateMentoringRequest, type MentoringInput } from "@/lib/alumni/validation";
import { cn } from "@/lib/utils";
import { requestMentoringAction } from "@/app/(back)/dashboard/alumni/actions";

const FIELDS = ["topic", "message"] as const;
type FieldName = (typeof FIELDS)[number];

/**
 * "Ask for mentoring" on an alumni profile (STUDENT). Shows the rules, then — depending on the state — the request
 * already sent to this alumni (pending or accepted, with "Withdraw request" / "End mentoring" and the contact once
 * accepted), the reason a request can't be sent (mentoring not available, 3 pending requests), or the form:
 * "Topic" (with the alumni's topics as shortcuts) and "Message" (20–1000 characters).
 */
export function AskMentoring({
  profile,
  initialRequest,
  pendingCount,
  onRequestChange,
}: {
  profile: ProfileDetail;
  /** Details of `profile.myRequest` when the server could load them. */
  initialRequest: MentoringRequest | null;
  /** PENDING requests of the student (all alumni), null while unknown. */
  pendingCount: number | null;
  onRequestChange: (request: MentoringRequest) => void;
}) {
  const t = useTranslations("alumni.ask");
  const tValidation = useTranslations("alumni.validation");
  const tActions = useTranslations("common.actions");
  const errors = useErrorFormatter();
  const online = useOnlineStatus();
  const [request, setRequest] = useState<MentoringRequest | null>(initialRequest);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<MentoringInput>({ topic: "", message: "" });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const report = (value: Feedback) => setFeedback({ ...value, at: Date.now() });
  const name = profile.user.firstname;

  const myRequest = profile.myRequest ?? null;
  const shown = request && myRequest && request.id === myRequest.id ? { ...request, status: myRequest.status } : request;
  const open_ = !!myRequest && (myRequest.status === "PENDING" || myRequest.status === "ACCEPTED");
  const limitReached = pendingCount !== null && pendingCount >= MAX_PENDING_PER_STUDENT;

  const changed = (next: MentoringRequest) => {
    setRequest(next);
    onRequestChange(next);
    invalidateQueries("alumni:mentoring");
  };

  const fieldId = (field: FieldName) => `ask-${field}`;
  const update = (field: FieldName, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    if (fieldErrors[field]) setFieldErrors((current) => ({ ...current, [field]: undefined }));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !online) return;
    const checked = validateMentoringRequest(values).errors;
    if (hasValidationErrors(checked)) {
      const found = Object.fromEntries(Object.entries(checked).map(([field, error]) => [field, tValidation(error.key, error.values)]));
      setFieldErrors(found);
      const first = FIELDS.find((field) => found[field]);
      if (first) document.getElementById(fieldId(first))?.focus();
      return;
    }
    setPending(true);
    try {
      const result = await requestMentoringAction(profile.id, values);
      if (result.ok && result.data) {
        setOpen(false);
        setValues({ topic: "", message: "" });
        changed(result.data);
        report({ type: "success", message: result.message ?? t("sent") });
        return;
      }
      const found = Object.fromEntries(
        Object.entries(result.fieldErrors ?? {}).filter(([field]) => (FIELDS as readonly string[]).includes(field))
      ) as Partial<Record<FieldName, string>>;
      setFieldErrors(found);
      if (Object.keys(found).length === 0) report({ type: "error", message: result.message ?? errors.forCode("GENERIC") });
    } catch {
      report({ type: "error", message: errors.forCode("NETWORK_ERROR") });
    } finally {
      setPending(false);
    }
  };

  const messageLength = normalizeText(values.message).length;
  const myRequestsLink = (
    <Link
      href={alumniPageHref("mentoring")}
      className="inline-flex rounded-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {t("myRequests")}
    </Link>
  );

  let body: React.ReactNode;
  if (open_) {
    body = (
      <div className="space-y-3">
        {shown ? (
          <MentoringCard request={shown} side="mentee" report={report} onChanged={(next) => changed(next)} />
        ) : (
          <p className="text-sm">{t(myRequest?.status === "ACCEPTED" ? "acceptedShort" : "pendingShort", { name })}</p>
        )}
        <p className="text-sm">{myRequestsLink}</p>
      </div>
    );
  } else if (!profile.mentoringAvailable) {
    body = <p className="text-sm text-muted-foreground">{t("unavailable", { name })}</p>;
  } else if (limitReached) {
    body = (
      <div className="space-y-2 text-sm">
        <p className="rounded-2xl border border-highlight/50 bg-highlight/15 px-4 py-3 text-foreground" data-testid="mentoring-limit">
          {t("limitText", { max: MAX_PENDING_PER_STUDENT })}
        </p>
        <p>{myRequestsLink}</p>
      </div>
    );
  } else {
    body = (
      <div className="space-y-4">
        {myRequest && (myRequest.status === "DECLINED" || myRequest.status === "CLOSED") && (
          <p className="text-sm text-muted-foreground">{t(myRequest.status === "DECLINED" ? "previousDeclined" : "previousClosed", { name })}</p>
        )}
        <MentoringRules />
        {pendingCount !== null && (
          <p className="text-sm text-muted-foreground" data-testid="pending-count">
            {t("pendingInfo", { count: pendingCount, max: MAX_PENDING_PER_STUDENT })}
          </p>
        )}
        {!open ? (
          <Button
            type="button"
            className="w-full rounded-full sm:w-auto"
            aria-expanded={false}
            disabled={!online}
            onClick={() => {
              setOpen(true);
              requestAnimationFrame(() => document.getElementById(fieldId("topic"))?.focus());
            }}
          >
            <Handshake className="h-4 w-4" aria-hidden="true" />
            {t("open")}
          </Button>
        ) : (
          <form id="ask-mentoring-form" onSubmit={submit} noValidate className="grid gap-4" aria-busy={pending || undefined}>
            <Field id={fieldId("topic")} label={t("topic")} hint={t("topicHint")} error={fieldErrors.topic}>
              {(props) => (
                <Input
                  {...props}
                  name="topic"
                  value={values.topic}
                  onChange={(event) => update("topic", event.target.value)}
                  maxLength={TOPIC_MAX_LENGTH}
                  autoComplete="off"
                  required
                />
              )}
            </Field>
            {profile.mentoringTopics.length > 0 && (
              <div role="group" aria-label={t("topicShortcuts", { name })} className="-mt-2 flex flex-wrap gap-1.5">
                {profile.mentoringTopics.map((topic) => (
                  <button
                    key={topic}
                    type="button"
                    aria-pressed={values.topic === topic}
                    onClick={() => update("topic", topic)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      values.topic === topic ? "border-primary bg-primary text-primary-foreground" : "border-primary/30 bg-background text-foreground hover:bg-accent"
                    )}
                  >
                    {topic}
                  </button>
                ))}
              </div>
            )}
            <Field
              id={fieldId("message")}
              label={t("message")}
              hint={t("messageHint", { min: MESSAGE_MIN_LENGTH, max: MESSAGE_MAX_LENGTH, count: messageLength })}
              error={fieldErrors.message}
            >
              {(props) => (
                <Textarea
                  {...props}
                  name="message"
                  value={values.message}
                  onChange={(event) => update("message", event.target.value)}
                  maxLength={MESSAGE_MAX_LENGTH}
                  rows={6}
                  placeholder={t("messagePlaceholder", { name })}
                  required
                />
              )}
            </Field>
            <p className="text-xs text-muted-foreground">{t("privacy", { name })}</p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
                <X className="h-4 w-4" aria-hidden="true" />
                {tActions("cancel")}
              </Button>
              <Button type="submit" disabled={pending || !online} aria-busy={pending || undefined}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                {pending ? t("sending") : t("send")}
              </Button>
            </div>
          </form>
        )}
        {!online && <p className="text-sm text-muted-foreground">{t("offline")}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <InlineFeedback feedback={feedback} />
      {body}
    </div>
  );
}
