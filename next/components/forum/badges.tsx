import { CheckCircle2, CircleCheckBig, EyeOff, GraduationCap, Lock, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { Subject } from "@/lib/types";
import { cn } from "@/lib/utils";

// Pills of the forum (Server and Client Components; Client Components need the "forum" messages).

const SUBJECT_COLOR_RE = /^#[0-9a-f]{6}$/i;

/** Subject name with its timetable colour as a dot ("No subject" when it was deleted). */
export function SubjectBadge({ subject, wrap = false, className }: { subject: Subject | null | undefined; wrap?: boolean; className?: string }) {
  const t = useTranslations("forum");
  const color = subject && SUBJECT_COLOR_RE.test(subject.color) ? subject.color : undefined;
  return (
    <Badge variant="outline" className={cn("max-w-full", wrap && "whitespace-normal", className)} data-subject={subject?.code ?? ""}>
      <span
        aria-hidden="true"
        className={cn("h-2.5 w-2.5 shrink-0 rounded-full", !color && "bg-muted-foreground")}
        style={color ? { backgroundColor: color } : undefined}
      />
      <span className={wrap ? "break-words" : "truncate"}>{subject?.name ?? t("noSubject")}</span>
    </Badge>
  );
}

/** "Certified": answer written by a teacher. */
export function CertifiedBadge() {
  const t = useTranslations("forum.answers");
  return (
    <Badge variant="success" title={t("certifiedHint")} data-badge="certified">
      <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{t("certified")}</span>
      <span className="sr-only">({t("certifiedHint")})</span>
    </Badge>
  );
}

/** "Accepted answer". */
export function AcceptedBadge() {
  const t = useTranslations("forum.answers");
  return (
    <Badge variant="success" data-badge="accepted">
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
      {t("accepted")}
    </Badge>
  );
}

/** "Solved" on a question with an accepted answer. */
export function SolvedBadge() {
  const t = useTranslations("forum.card");
  return (
    <Badge variant="success" data-badge="solved">
      <CircleCheckBig className="h-3.5 w-3.5" aria-hidden="true" />
      {t("solved")}
    </Badge>
  );
}

/** "Teacher answer" on a question that has a certified answer. */
export function TeacherAnswerBadge() {
  const t = useTranslations("forum.card");
  return (
    <Badge variant="secondary" data-badge="teacher-answer">
      <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" />
      {t("teacherAnswer")}
    </Badge>
  );
}

export function ClosedBadge() {
  const t = useTranslations("forum.card");
  return (
    <Badge variant="neutral" data-badge="closed">
      <Lock className="h-3.5 w-3.5" aria-hidden="true" />
      {t("closed")}
    </Badge>
  );
}

/** Hidden content (only ADMINs and its author receive it). */
export function HiddenBadge() {
  const t = useTranslations("forum.card");
  return (
    <Badge variant="danger" data-badge="hidden">
      <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
      {t("hidden")}
    </Badge>
  );
}

/** "Waiting to sync": an answer written offline, still in the outbox. */
export function PendingBadge() {
  const t = useTranslations("forum.answers");
  return (
    <Badge variant="warning" data-badge="pending">
      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
      {t("pending")}
    </Badge>
  );
}
