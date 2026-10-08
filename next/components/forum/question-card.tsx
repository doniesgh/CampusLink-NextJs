"use client";

import { CheckCircle2, Eye, MessageSquare, ThumbsUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDateTimeLabel } from "@/components/announcements/use-format";
import { AuthorLink } from "@/components/forum/author-link";
import { ClosedBadge, HiddenBadge, SolvedBadge, SubjectBadge, TeacherAnswerBadge } from "@/components/forum/badges";
import { TagChip } from "@/components/forum/tag-chip";
import Link from "@/components/ui/app-link";
import { questionHref } from "@/lib/forum/paths";
import type { Question } from "@/lib/forum/types";
import { cn } from "@/lib/utils";

/** First lines of the body on one paragraph (the card shows 2 lines at most). */
function excerptOf(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 280);
}

function Stats({ question, className }: { question: Question; className?: string }) {
  const t = useTranslations("forum.card");
  const solved = !!question.acceptedAnswerId;
  return (
    <ul className={cn("flex text-xs text-muted-foreground", className)}>
      <li className="inline-flex items-center gap-1">
        <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
        {t("votes", { count: question.score })}
      </li>
      <li className={cn("inline-flex items-center gap-1", solved && "font-semibold text-success")}>
        {solved ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />}
        {t("answers", { count: question.answerCount })}
      </li>
      <li className="inline-flex items-center gap-1">
        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
        {t("views", { count: question.viewCount })}
      </li>
    </ul>
  );
}

/**
 * One question of the list: an <article> whose title links to the question (the whole card is clickable),
 * with the subject, "Solved" / "Teacher answer" / "Closed" / "Hidden" pills, an excerpt, the tags, the
 * votes / answers / views counts, the author and the date.
 */
export function QuestionCard({
  question,
  activeTag,
  onTagSelect,
  onLinkClick,
}: {
  question: Question;
  activeTag?: string;
  /** Tags filter the list in place (list page). */
  onTagSelect?: (tag: string) => void;
  /** Offline handling of the title link (list page). */
  onLinkClick?: (event: React.MouseEvent<HTMLAnchorElement>, question: Question) => void;
}) {
  const tQuestion = useTranslations("forum.question");
  const dateLabel = useDateTimeLabel();

  return (
    <article
      className={cn(
        "group relative rounded-2xl border bg-card p-4 text-card-foreground transition-colors hover:bg-accent/50 focus-within:ring-2 focus-within:ring-ring sm:p-5",
        question.hidden && "border-dashed border-destructive/40"
      )}
      data-question-id={question.id}
      data-status={question.status}
      data-hidden={question.hidden ? "true" : "false"}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SubjectBadge subject={question.subject} />
        {question.acceptedAnswerId && <SolvedBadge />}
        {question.hasCertifiedAnswer && <TeacherAnswerBadge />}
        {question.status === "CLOSED" && <ClosedBadge />}
        {question.hidden && <HiddenBadge />}
      </div>
      <h3 className="mt-2 break-words text-base font-semibold leading-snug text-foreground sm:text-lg">
        <Link
          href={questionHref(question.id)}
          onClick={onLinkClick ? (event) => onLinkClick(event, question) : undefined}
          className="rounded-sm after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none"
        >
          {question.title}
        </Link>
      </h3>
      {question.body && <p className="mt-1 line-clamp-2 break-words text-sm text-muted-foreground">{excerptOf(question.body)}</p>}
      {question.tags.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {question.tags.map((tag) => (
            <li key={tag}>
              <TagChip tag={tag} onSelect={onTagSelect} active={activeTag === tag} />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <Stats question={question} className="flex-wrap gap-x-3 gap-y-1" />
        <p className="flex flex-wrap items-center gap-x-1.5">
          <span>{tQuestion("askedBy")}</span>
          <AuthorLink author={question.author} showRole={false} />
          <span aria-hidden="true">·</span>
          <time dateTime={question.createdAt}>{dateLabel(question.createdAt)}</time>
        </p>
      </div>
    </article>
  );
}
