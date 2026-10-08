"use client";

import { useState } from "react";
import { Check, Eye, EyeOff, Flag, Loader2, Pencil, Trash2, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDateTimeLabel } from "@/components/announcements/use-format";
import { AuthorLink } from "@/components/forum/author-link";
import { AcceptedBadge, CertifiedBadge, HiddenBadge, PendingBadge } from "@/components/forum/badges";
import { ForumText } from "@/components/forum/forum-text";
import { HiddenNotice } from "@/components/forum/hidden-notice";
import { ReasonDialog } from "@/components/forum/reason-dialog";
import { VoteControl } from "@/components/forum/vote-control";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { InlineFeedback, type Feedback } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useErrorFormatter } from "@/lib/i18n/client";
import type { PendingAnswer } from "@/lib/forum/pending";
import { ANSWER_MAX_LENGTH, REASON_MAX_LENGTH, type Answer, type QuestionDetail } from "@/lib/forum/types";
import { validateAnswer, validateReason } from "@/lib/forum/validation";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  acceptAnswerAction,
  deleteAnswerAction,
  reportAction,
  updateAnswerAction,
  voteAction,
} from "@/app/(back)/dashboard/forum/actions";
import { setHiddenAction } from "@/app/(back)/dashboard/admin/forum/actions";

export type ForumViewer = { id: string; role: Role; firstname: string; lastname: string };

type ActionResult<T> = { ok?: boolean; message?: string; fieldErrors?: Record<string, string>; data?: T };

const ACTION_BUTTON = "h-9 rounded-full px-3";

/** Inline "Edit your answer" form of the author. */
function AnswerEditor({ answer, onSaved, onCancel }: { answer: Answer; onSaved: (answer: Answer, message?: string) => void; onCancel: () => void }) {
  const t = useTranslations("forum.answers");
  const tValidation = useTranslations("forum.validation");
  const tActions = useTranslations("common.actions");
  const errors = useErrorFormatter();
  const [body, setBody] = useState(answer.body);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const fieldId = `answer-edit-${answer.id}`;

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const invalid = validateAnswer(body);
    if (invalid) {
      setError(tValidation(invalid.key, invalid.values));
      document.getElementById(fieldId)?.focus();
      return;
    }
    setPending(true);
    try {
      const result = await updateAnswerAction(answer.id, body);
      if (result.ok && result.data) onSaved(result.data, result.message);
      else setError(result.fieldErrors?.body ?? result.message ?? errors.forCode("GENERIC"));
    } catch {
      setError(errors.forCode("NETWORK_ERROR"));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={save} noValidate className="space-y-3">
      <Field id={fieldId} label={t("editLabel")} error={error ?? undefined}>
        {(props) => (
          <Textarea
            {...props}
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
              if (error) setError(null);
            }}
            maxLength={ANSWER_MAX_LENGTH}
            rows={6}
            autoFocus
          />
        )}
      </Field>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          {tActions("cancel")}
        </Button>
        <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {t("save")}
        </Button>
      </div>
    </form>
  );
}

/**
 * One answer (`article#answer-<id>`, the anchor of the notification links): "Accepted answer" and "Certified"
 * pills, the plain-text body, the author, and the actions allowed to the viewer: votes, "Accept this answer"
 * (question author), "Edit" / "Delete" (author; ADMIN may delete), "Report", "Hide" / "Unhide" (ADMIN).
 * Every action needs the connection (`online`).
 */
export function AnswerCard({
  answer,
  viewer,
  questionAuthorId,
  online,
  feedback,
  onChange,
  onDetail,
  onRemoved,
  onFeedback,
}: {
  answer: Answer;
  viewer: ForumViewer;
  questionAuthorId: string | null;
  online: boolean;
  /** Feedback anchored to this answer (shown under it). */
  feedback: Feedback | null;
  onChange: (answer: Answer) => void;
  onDetail: (detail: QuestionDetail) => void;
  onRemoved: (answer: Answer) => void;
  onFeedback: (feedback: Feedback) => void;
}) {
  const t = useTranslations("forum.answers");
  const tReport = useTranslations("forum.report");
  const tModeration = useTranslations("forum.moderation");
  const tQuestion = useTranslations("forum.question");
  const tValidation = useTranslations("forum.validation");
  const tActions = useTranslations("common.actions");
  const errors = useErrorFormatter();
  const dateLabel = useDateTimeLabel();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const isAdmin = viewer.role === "ADMIN";
  const isAuthor = !!answer.author && answer.author.id === viewer.id;
  const isQuestionAuthor = !!questionAuthorId && questionAuthorId === viewer.id;
  const hidden = !!answer.hidden;

  /**
   * Runs a Server Action and reports its outcome under this answer. Returns the error message, or null.
   * `inDialog`: the error is shown by the dialog that started the action, not under the answer.
   */
  const run = async <T,>(
    action: () => Promise<ActionResult<T>>,
    onData?: (data: T) => void,
    { inDialog = false }: { inDialog?: boolean } = {}
  ): Promise<string | null> => {
    setBusy(true);
    try {
      const result = await action();
      if (!result.ok) {
        const message = result.fieldErrors?.reason ?? result.message ?? errors.forCode("GENERIC");
        if (!inDialog) onFeedback({ type: "error", message });
        return message;
      }
      if (result.data !== undefined && onData) onData(result.data);
      if (result.message) onFeedback({ type: "success", message: result.message });
      return null;
    } catch {
      const message = errors.forCode("NETWORK_ERROR");
      if (!inDialog) onFeedback({ type: "error", message });
      return message;
    } finally {
      setBusy(false);
    }
  };

  const vote = async (value: 1 | -1) => {
    await run(() => voteAction("answers", answer.id, value), (data) => onChange({ ...answer, ...data }));
  };

  const toggleAccepted = () => run(() => acceptAnswerAction(answer.questionId, answer.accepted ? null : answer.id), onDetail);

  const remove = async () => {
    const failure = await run(() => deleteAnswerAction(answer.id));
    if (!failure) onRemoved(answer);
  };

  const setHidden = (value: boolean, reason?: string) =>
    run(
      () => setHiddenAction("answers", answer.id, value, { reason }),
      (data) => onChange({ ...answer, ...(data as Answer) }),
      { inDialog: value }
    );

  return (
    <article
      id={`answer-${answer.id}`}
      // Focusable target of the notification links (#answer-<id>), not in the tab order.
      tabIndex={-1}
      className={cn(
        "scroll-mt-24 space-y-4 rounded-2xl border bg-card p-4 text-card-foreground outline-none target:ring-2 target:ring-primary focus-visible:ring-2 focus-visible:ring-ring sm:p-5",
        answer.accepted && "border-success/50 bg-success/5",
        hidden && "border-dashed border-destructive/40"
      )}
      data-answer-id={answer.id}
      data-accepted={answer.accepted ? "true" : "false"}
      data-certified={answer.certified ? "true" : "false"}
      data-hidden={hidden ? "true" : "false"}
    >
      {(answer.accepted || answer.certified || hidden) && (
        <div className="flex flex-wrap items-center gap-2">
          {answer.accepted && <AcceptedBadge />}
          {answer.certified && <CertifiedBadge />}
          {hidden && <HiddenBadge />}
        </div>
      )}
      {hidden && <HiddenNotice reason={answer.hiddenReason} viewerIsAdmin={isAdmin} />}

      {editing ? (
        <AnswerEditor
          answer={answer}
          onCancel={() => setEditing(false)}
          onSaved={(saved, message) => {
            setEditing(false);
            onChange({ ...answer, ...saved });
            if (message) onFeedback({ type: "success", message });
          }}
        />
      ) : (
        <ForumText text={answer.body} testId="answer-body" />
      )}

      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
        <span>{t("answeredBy")}</span>
        <AuthorLink author={answer.author} />
        <span aria-hidden="true">·</span>
        <time dateTime={answer.createdAt}>{dateLabel(answer.createdAt)}</time>
        {answer.editedAt && (
          <>
            <span aria-hidden="true">·</span>
            <span>{tQuestion("edited", { date: dateLabel(answer.editedAt) ?? "" })}</span>
          </>
        )}
      </p>

      {!editing && (
        <div role="group" aria-label={t("actions")} className="flex flex-wrap items-center gap-2" aria-busy={busy || undefined}>
          <VoteControl kind="answer" score={answer.score} myVote={answer.myVote} ownContent={isAuthor} disabled={!online || hidden} onVote={vote} />
          {isQuestionAuthor && !hidden && (
            <Button
              type="button"
              variant={answer.accepted ? "outline" : "secondary"}
              size="sm"
              className={ACTION_BUTTON}
              disabled={!online || busy}
              onClick={() => void toggleAccepted()}
            >
              {answer.accepted ? <Undo2 className="h-4 w-4" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
              {answer.accepted ? t("unaccept") : t("accept")}
            </Button>
          )}
          {isAuthor && (
            <Button type="button" variant="ghost" size="sm" className={ACTION_BUTTON} disabled={!online || busy} onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
              {tActions("edit")}
            </Button>
          )}
          {(isAuthor || isAdmin) && !answer.accepted && (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="ghost" size="sm" className={cn(ACTION_BUTTON, "text-destructive hover:text-destructive")} disabled={!online || busy}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  {tActions("delete")}
                </Button>
              }
              title={t("confirmDeleteTitle")}
              description={t("confirmDeleteText")}
              confirmLabel={tActions("confirmDelete")}
              onConfirm={remove}
            />
          )}
          {!isAuthor && !hidden && (
            <ReasonDialog
              trigger={
                <Button type="button" variant="ghost" size="sm" className={ACTION_BUTTON} disabled={!online || busy}>
                  <Flag className="h-4 w-4" aria-hidden="true" />
                  {tReport("button")}
                </Button>
              }
              title={tReport("answerTitle")}
              description={tReport("description")}
              label={tReport("reason")}
              submitLabel={tReport("submit")}
              maxLength={REASON_MAX_LENGTH}
              validate={(value) => {
                const invalid = validateReason(value);
                return invalid ? tValidation(invalid.key, invalid.values) : null;
              }}
              onSubmit={(reason) => run(() => reportAction("answers", answer.id, reason), undefined, { inDialog: true })}
            />
          )}
          {isAdmin &&
            (hidden ? (
              <Button type="button" variant="ghost" size="sm" className={ACTION_BUTTON} disabled={!online || busy} onClick={() => void setHidden(false)}>
                <Eye className="h-4 w-4" aria-hidden="true" />
                {tModeration("unhide")}
              </Button>
            ) : (
              <ReasonDialog
                trigger={
                  <Button type="button" variant="ghost" size="sm" className={cn(ACTION_BUTTON, "text-destructive hover:text-destructive")} disabled={!online || busy}>
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                    {tModeration("hide")}
                  </Button>
                }
                title={tModeration("hideAnswerTitle")}
                description={tModeration("hideDescription")}
                label={tModeration("hideReason")}
                submitLabel={tModeration("hide")}
                maxLength={REASON_MAX_LENGTH}
                destructive
                onSubmit={(reason) => setHidden(true, reason)}
              />
            ))}
        </div>
      )}
      <InlineFeedback feedback={feedback} />
    </article>
  );
}

/** An answer written offline, still in the outbox: shown with "Waiting to sync" and no actions. */
export function PendingAnswerCard({ pending, viewer }: { pending: PendingAnswer; viewer: ForumViewer }) {
  const t = useTranslations("forum.answers");
  return (
    <article
      className="space-y-4 rounded-2xl border border-dashed border-highlight/60 bg-highlight/5 p-4 text-card-foreground sm:p-5"
      data-pending="true"
      data-client-request-id={pending.clientRequestId}
    >
      <div className="flex flex-wrap items-center gap-2">
        <PendingBadge />
      </div>
      <ForumText text={pending.body} testId="answer-body" />
      <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
        <span>{t("answeredBy")}</span>
        <span className="font-medium text-foreground">
          {`${viewer.firstname} ${viewer.lastname}`.trim() || t("you")}
        </span>
      </p>
      <p className="text-sm text-muted-foreground">{t("pendingHint")}</p>
    </article>
  );
}
