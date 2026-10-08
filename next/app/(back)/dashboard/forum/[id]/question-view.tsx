"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bell, BellOff, CloudOff, Eye, EyeOff, Flag, Lock, LockOpen, MessagesSquare, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDateTimeLabel } from "@/components/announcements/use-format";
import { AnswerCard, PendingAnswerCard, type ForumViewer } from "@/components/forum/answer-card";
import { AnswerForm } from "@/components/forum/answer-form";
import { AuthorLink } from "@/components/forum/author-link";
import { ClosedBadge, HiddenBadge, SolvedBadge, SubjectBadge } from "@/components/forum/badges";
import { ForumText } from "@/components/forum/forum-text";
import { HiddenNotice } from "@/components/forum/hidden-notice";
import { ForumNotFound } from "@/components/forum/not-found-state";
import { QuestionForm } from "@/components/forum/question-form";
import { ReasonDialog } from "@/components/forum/reason-dialog";
import { TagChip } from "@/components/forum/tag-chip";
import { VoteControl } from "@/components/forum/vote-control";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import Link from "@/components/ui/app-link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback, type Feedback } from "@/components/ui/feedback";
import { SkeletonList } from "@/components/ui/skeleton";
import { useErrorFormatter } from "@/lib/i18n/client";
import { useOfflineQuery, useOnlineStatus } from "@/lib/offline";
import { usePendingAnswers } from "@/lib/forum/pending";
import { forumHref, questionKey, questionPath } from "@/lib/forum/paths";
import { useForumSubjects } from "@/lib/forum/queries";
import { REASON_MAX_LENGTH, type Answer, type Question, type QuestionDetail } from "@/lib/forum/types";
import { validateReason } from "@/lib/forum/validation";
import { cn } from "@/lib/utils";
import { setHiddenAction } from "@/app/(back)/dashboard/admin/forum/actions";
import {
  deleteQuestionAction,
  followQuestionAction,
  reportAction,
  setQuestionStatusAction,
  updateQuestionAction,
  voteAction,
} from "@/app/(back)/dashboard/forum/actions";

type Anchored = { anchor: string; value: Feedback } | null;
type ActionResult<T> = { ok?: boolean; message?: string; fieldErrors?: Record<string, string>; data?: T };

const ACTION_BUTTON = "h-9 rounded-full px-3";
const QUESTION_ANCHOR = "question";
const FORM_ANCHOR = "form";
const ANSWERS_ANCHOR = "answers";

function BackLink() {
  const t = useTranslations("forum.question");
  return (
    <Link
      href={forumHref}
      className="inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {t("back")}
    </Link>
  );
}

/** Subject, level, chapter, author, date, views. */
function QuestionMeta({ question }: { question: Question }) {
  const t = useTranslations("forum.question");
  const tForum = useTranslations("forum");
  const tCard = useTranslations("forum.card");
  const dateLabel = useDateTimeLabel();
  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span>{t("askedBy")}</span>
        <AuthorLink author={question.author} />
        <span aria-hidden="true">·</span>
        <time dateTime={question.createdAt}>{dateLabel(question.createdAt)}</time>
        {question.editedAt && (
          <>
            <span aria-hidden="true">·</span>
            <span>{t("edited", { date: dateLabel(question.editedAt) ?? "" })}</span>
          </>
        )}
        <span aria-hidden="true">·</span>
        <span className="inline-flex items-center gap-1">
          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          {tCard("views", { count: question.viewCount })}
        </span>
      </p>
      {(question.chapter || question.level) && (
        <p className="flex flex-wrap items-center gap-x-1.5">
          {question.level && <span>{tForum("levelValue", { level: question.level })}</span>}
          {question.level && question.chapter && <span aria-hidden="true">·</span>}
          {question.chapter && <span className="break-words">{t("chapter", { chapter: question.chapter })}</span>}
        </p>
      )}
    </div>
  );
}

/**
 * /dashboard/forum/[id]: the question, its answers (accepted first, "Certified" for teachers), votes, accept,
 * follow, report, the author's and the moderators' actions, and the answer form. Readable offline (IndexedDB
 * copy); answers written offline wait in the outbox ("Waiting to sync") and are posted on reconnection.
 */
export function QuestionView({
  id,
  initial,
  viewer,
}: {
  id: string;
  initial: { data: QuestionDetail; savedAt: number } | null;
  viewer: ForumViewer;
}) {
  const t = useTranslations("forum.question");
  const tAnswers = useTranslations("forum.answers");
  const tForm = useTranslations("forum.answerForm");
  const tAsk = useTranslations("forum.ask");
  const tReport = useTranslations("forum.report");
  const tModeration = useTranslations("forum.moderation");
  const tValidation = useTranslations("forum.validation");
  const tStates = useTranslations("common.states");
  const tActions = useTranslations("common.actions");
  const errors = useErrorFormatter();
  const router = useRouter();
  const online = useOnlineStatus();
  const { data, isLoading, error, mutate, refresh } = useOfflineQuery<QuestionDetail>(questionKey(id), questionPath(id), {
    fallbackData: initial?.data,
    fallbackSavedAt: initial?.savedAt,
    revalidateOnMount: !initial,
  });
  const pendingAnswers = usePendingAnswers(id);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [anchored, setAnchored] = useState<Anchored>(null);
  // Subjects are only needed by the edit form (saved for offline use like the list filters).
  const subjects = useForumSubjects(undefined, editing);

  // Notification links point at "#answer-<id>": the page streams in after the browser looked for the anchor
  // (dashboard loading state), so scroll to it once the thread is shown.
  const scrolledToAnchor = useRef(false);
  const hasThread = !!data?.question;
  useEffect(() => {
    if (scrolledToAnchor.current || !hasThread) return;
    const anchor = decodeURIComponent(window.location.hash.slice(1));
    if (!anchor.startsWith("answer-")) return;
    const element = document.getElementById(anchor);
    if (!element) return;
    scrolledToAnchor.current = true;
    element.scrollIntoView({ block: "start" });
    element.focus({ preventScroll: true });
  }, [hasThread]);

  const report = (anchor: string) => (value: Feedback) => setAnchored({ anchor, value: { ...value, at: Date.now() } });
  const feedbackAt = (anchor: string) => (anchored?.anchor === anchor ? anchored.value : null);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <BackLink />
        <h1 className="sr-only">{t("loadingTitle")}</h1>
        <SkeletonList rows={4} label={tStates("loading")} />
      </div>
    );
  }

  if (!data?.question) {
    if (error?.status === 404 || error?.status === 400) {
      return <ForumNotFound title={t("notFoundTitle")} description={t("notFoundText")} backHref={forumHref} backLabel={t("back")} />;
    }
    const offline = !online || error?.isNetworkError || error?.code === "OFFLINE";
    return (
      <div className="space-y-6">
        <BackLink />
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{t("loadingTitle")}</h1>
        {offline ? (
          <EmptyState icon={CloudOff} title={t("notSavedTitle")} description={t("notSavedText")} />
        ) : (
          <InlineFeedback feedback={{ type: "error", message: error ? errors.message(error) : t("loadError") }} />
        )}
      </div>
    );
  }

  const { question } = data;
  const answers = Array.isArray(data.answers) ? data.answers : [];
  const isAdmin = viewer.role === "ADMIN";
  const isAuthor = !!question.author && question.author.id === viewer.id;
  const hidden = !!question.hidden;
  const closed = question.status === "CLOSED";

  // ---- local updates of the saved thread (the API answers with the new state)
  const patchQuestion = (patch: Partial<Question>) =>
    mutate((current) => (current ? { ...current, question: { ...current.question, ...patch } } : current));
  const patchAnswer = (answer: Answer) =>
    mutate((current) =>
      current ? { ...current, answers: current.answers.map((item) => (item.id === answer.id ? { ...item, ...answer } : item)) } : current
    );
  const removeAnswer = (answer: Answer) => {
    mutate((current) =>
      current
        ? {
            question: { ...current.question, answerCount: Math.max(0, current.question.answerCount - (answer.hidden ? 0 : 1)) },
            answers: current.answers.filter((item) => item.id !== answer.id),
          }
        : current
    );
    report(ANSWERS_ANCHOR)({ type: "success", message: tAnswers("deleted") });
    void refresh();
  };
  const addAnswer = (answer: Answer) => {
    mutate((current) =>
      current && !current.answers.some((item) => item.id === answer.id)
        ? {
            question: { ...current.question, answerCount: current.question.answerCount + 1, lastActivityAt: answer.createdAt },
            answers: [...current.answers, answer],
          }
        : current
    );
    void refresh();
  };

  /** Runs a Server Action of the question; `inDialog` errors are shown by the dialog that started it. */
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
        if (!inDialog) report(QUESTION_ANCHOR)({ type: "error", message });
        return message;
      }
      if (result.data !== undefined && onData) onData(result.data);
      if (result.message) report(QUESTION_ANCHOR)({ type: "success", message: result.message });
      return null;
    } catch {
      const message = errors.forCode("NETWORK_ERROR");
      if (!inDialog) report(QUESTION_ANCHOR)({ type: "error", message });
      return message;
    } finally {
      setBusy(false);
    }
  };

  const vote = async (value: 1 | -1) => {
    await run(() => voteAction("questions", question.id, value), (result) => patchQuestion(result));
  };
  const toggleFollow = () => run(() => followQuestionAction(question.id, !question.following), (result) => patchQuestion(result));
  const toggleStatus = () =>
    run(() => setQuestionStatusAction(question.id, closed ? "OPEN" : "CLOSED"), (saved) => patchQuestion({ status: saved.status, editedAt: saved.editedAt }));
  const remove = async () => {
    const failure = await run(() => deleteQuestionAction(question.id));
    if (!failure) router.push(`${forumHref}?done=deleted`);
  };
  const setHidden = (value: boolean, reason?: string) =>
    run(() => setHiddenAction("questions", question.id, value, { reason }), (saved) => patchQuestion(saved as Question), { inDialog: value });

  const canDelete = (isAuthor || isAdmin) && answers.length === 0 && question.answerCount === 0;

  return (
    <div className="space-y-8">
      <BackLink />

      <article aria-labelledby="question-title" className="space-y-5" data-question-id={question.id} data-status={question.status} data-hidden={hidden ? "true" : "false"}>
        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <SubjectBadge subject={question.subject} />
            {question.acceptedAnswerId && <SolvedBadge />}
            {closed && <ClosedBadge />}
            {hidden && <HiddenBadge />}
          </div>
          <h1 id="question-title" className="break-words text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {question.title}
          </h1>
          <QuestionMeta question={question} />
        </header>

        {hidden && <HiddenNotice reason={question.hiddenReason} viewerIsAdmin={isAdmin} />}

        {editing ? (
          <section aria-labelledby="question-editor-heading" className="rounded-3xl border bg-card p-5 text-card-foreground sm:p-6">
            <h2 id="question-editor-heading" className="mb-4 text-lg font-semibold">
              {tAsk("editTitle")}
            </h2>
            <QuestionForm
              idPrefix="question-edit"
              mode="edit"
              subjects={subjects.length > 0 ? subjects : question.subject ? [question.subject] : []}
              excludeId={question.id}
              initialValues={{
                title: question.title,
                body: question.body,
                subject: question.subject?.id ?? "",
                chapter: question.chapter ?? "",
                level: question.level ? String(question.level) : "",
                tags: question.tags.join(", "),
              }}
              onCancel={() => setEditing(false)}
              onFailure={(message) => report(QUESTION_ANCHOR)({ type: "error", message })}
              submit={async (input) => {
                try {
                  const result = await updateQuestionAction(question.id, input);
                  if (result.ok && result.data) {
                    patchQuestion(result.data);
                    setEditing(false);
                    report(QUESTION_ANCHOR)({ type: "success", message: result.message ?? t("saved") });
                  }
                  return result;
                } catch {
                  return { ok: false, message: errors.forCode("NETWORK_ERROR") };
                }
              }}
            />
          </section>
        ) : (
          <div className="rounded-3xl border bg-card p-5 text-card-foreground sm:p-6">
            <ForumText text={question.body} testId="question-body" />
          </div>
        )}

        {question.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">{t("tags")}</span>
            <ul className="flex flex-wrap gap-1.5">
              {question.tags.map((tag) => (
                <li key={tag}>
                  <TagChip tag={tag} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {!editing && (
          <div role="group" aria-label={t("actions")} className="flex flex-wrap items-center gap-2" aria-busy={busy || undefined}>
            <VoteControl kind="question" score={question.score} myVote={question.myVote} ownContent={isAuthor} disabled={!online || hidden} onVote={vote} />
            {!hidden && (
              <Button
                type="button"
                variant={question.following ? "secondary" : "outline"}
                size="sm"
                className={ACTION_BUTTON}
                disabled={!online || busy}
                onClick={() => void toggleFollow()}
              >
                {question.following ? <BellOff className="h-4 w-4" aria-hidden="true" /> : <Bell className="h-4 w-4" aria-hidden="true" />}
                {question.following ? t("unfollow") : t("follow")}
              </Button>
            )}
            {isAuthor && (
              <Button type="button" variant="ghost" size="sm" className={ACTION_BUTTON} disabled={!online || busy} onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                {tActions("edit")}
              </Button>
            )}
            {(isAuthor || isAdmin) && (
              <Button type="button" variant="ghost" size="sm" className={ACTION_BUTTON} disabled={!online || busy} onClick={() => void toggleStatus()}>
                {closed ? <LockOpen className="h-4 w-4" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
                {closed ? t("reopen") : t("close")}
              </Button>
            )}
            {canDelete && (
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
                title={tReport("questionTitle")}
                description={tReport("description")}
                label={tReport("reason")}
                submitLabel={tReport("submit")}
                maxLength={REASON_MAX_LENGTH}
                validate={(value) => {
                  const invalid = validateReason(value);
                  return invalid ? tValidation(invalid.key, invalid.values) : null;
                }}
                onSubmit={(reason) => run(() => reportAction("questions", question.id, reason), undefined, { inDialog: true })}
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
                  title={tModeration("hideQuestionTitle")}
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
        {question.following && !hidden && <p className="text-sm text-muted-foreground">{t("followingHint")}</p>}
        {!online && <p className="text-sm text-muted-foreground">{t("offlineActions")}</p>}
        <InlineFeedback feedback={feedbackAt(QUESTION_ANCHOR)} />
      </article>

      <section aria-labelledby="answers-title" className="space-y-4">
        <h2 id="answers-title" className="text-xl font-semibold tracking-tight text-foreground">
          {tAnswers("heading", { count: answers.length })}
        </h2>
        <InlineFeedback feedback={feedbackAt(ANSWERS_ANCHOR)} />
        {answers.length === 0 && pendingAnswers.items.length === 0 ? (
          <EmptyState icon={MessagesSquare} title={tAnswers("emptyText")} headingLevel="p" />
        ) : (
          <ol className="space-y-4">
            {answers.map((answer) => (
              <li key={answer.id}>
                <AnswerCard
                  answer={answer}
                  viewer={viewer}
                  questionAuthorId={question.author?.id ?? null}
                  online={online}
                  feedback={feedbackAt(`answer:${answer.id}`)}
                  onChange={patchAnswer}
                  onDetail={(detail) => mutate(detail)}
                  onRemoved={removeAnswer}
                  onFeedback={report(`answer:${answer.id}`)}
                />
              </li>
            ))}
            {pendingAnswers.items.map((pending) => (
              <li key={pending.clientRequestId}>
                <PendingAnswerCard pending={pending} viewer={viewer} />
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="answer-form-title" className="space-y-4 rounded-3xl border bg-card p-5 text-card-foreground sm:p-6">
        <h2 id="answer-form-title" className="text-lg font-semibold text-foreground">
          {tForm("title")}
        </h2>
        {closed || hidden ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {closed ? t("closedNotice") : tForm("hiddenQuestion")}
          </p>
        ) : (
          <AnswerForm
            questionId={question.id}
            onPosted={addAnswer}
            onQueued={() => void pendingAnswers.reload()}
            onFeedback={report(FORM_ANCHOR)}
          />
        )}
        <InlineFeedback feedback={feedbackAt(FORM_ANCHOR)} />
      </section>
    </div>
  );
}
