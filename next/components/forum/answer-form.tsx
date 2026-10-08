"use client";

import { useState } from "react";
import { CloudOff, Loader2, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { Feedback } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useErrorFormatter } from "@/lib/i18n/client";
import { queueMutation, useOnlineStatus, type BffError } from "@/lib/offline";
import { answerOutboxPath, newClientRequestId } from "@/lib/forum/pending";
import { ANSWER_MAX_LENGTH, type Answer } from "@/lib/forum/types";
import { normalizeText, validateAnswer } from "@/lib/forum/validation";

/**
 * "Your answer" + "Post answer". Works offline: the answer is sent with queueMutation() and a clientRequestId
 * (UUID); without a connection it waits in the outbox, shows as "Waiting to sync" (usePendingAnswers) and is
 * posted on reconnection. A replay of the same clientRequestId never creates a second answer (API rule).
 */
export function AnswerForm({
  questionId,
  onPosted,
  onQueued,
  onFeedback,
}: {
  questionId: string;
  /** The API answered (201 created, or 200 for a replay). */
  onPosted: (answer: Answer) => void;
  /** Stored in the outbox (offline or server unreachable). */
  onQueued: () => void;
  onFeedback: (feedback: Feedback) => void;
}) {
  const t = useTranslations("forum.answerForm");
  const tValidation = useTranslations("forum.validation");
  const tErrors = useTranslations("forum.errors");
  const errors = useErrorFormatter();
  const online = useOnlineStatus();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const fieldId = `answer-body-${questionId}`;

  const failureMessage = (failure: BffError) => {
    if (failure.code === "INVALID_STATE") return tErrors("questionClosed");
    if (failure.code === "ALREADY_EXISTS") return tErrors("duplicateAnswer");
    if (failure.code === "RESOURCE_NOT_FOUND") return tErrors("notFound");
    return errors.message(failure);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const invalid = validateAnswer(body);
    if (invalid) {
      setError(tValidation(invalid.key, invalid.values));
      document.getElementById(fieldId)?.focus();
      return;
    }
    setPending(true);
    try {
      const clientRequestId = newClientRequestId();
      const result = await queueMutation<Answer>({
        method: "POST",
        path: answerOutboxPath(questionId, clientRequestId),
        body: { body: normalizeText(body), clientRequestId },
      });
      if (result.status === "failed") {
        const fieldError = errors.fieldErrors(result.error).body;
        if (fieldError) setError(fieldError);
        onFeedback({ type: "error", message: failureMessage(result.error) });
        return;
      }
      setBody("");
      setError(null);
      if (result.status === "sent") {
        onPosted(result.data);
        onFeedback({ type: "success", message: t("posted") });
      } else {
        onQueued();
        onFeedback({ type: "info", message: t("queued") });
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-busy={pending || undefined}>
      <Field id={fieldId} label={t("label")} hint={online ? t("hint") : t("offlineHint")} error={error ?? undefined}>
        {(props) => (
          <Textarea
            {...props}
            name="body"
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
              if (error) setError(null);
            }}
            maxLength={ANSWER_MAX_LENGTH}
            rows={6}
            required
          />
        )}
      </Field>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : online ? (
            <Send className="h-4 w-4" aria-hidden="true" />
          ) : (
            <CloudOff className="h-4 w-4" aria-hidden="true" />
          )}
          {pending ? t("submitting") : t("submit")}
        </Button>
      </div>
    </form>
  );
}
