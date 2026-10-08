"use client";

import {
  BookOpenText,
  CircleCheck,
  CircleSlash,
  ClipboardList,
  Coins,
  FileQuestion,
  FileText,
  Hourglass,
  Library,
  NotebookPen,
  Presentation,
  Sparkles,
  UserRound,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { DocumentStatus, DocumentType } from "@/lib/marketplace/types";
import type { Subject } from "@/lib/types";
import { cn } from "@/lib/utils";

// Pills of the marketplace (Client Components with the "marketplace" messages).

const SUBJECT_COLOR_RE = /^#[0-9a-f]{6}$/i;

export const TYPE_ICONS: Record<DocumentType, LucideIcon> = {
  COURSE_NOTES: NotebookPen,
  SUMMARY: BookOpenText,
  EXERCISES: ClipboardList,
  EXAM_PREP: Sparkles,
  SLIDES: Presentation,
  OTHER: FileText,
};

/** "Free" (green) or "12 tokens" (coral). */
export function PriceBadge({ price, className }: { price: number; className?: string }) {
  const t = useTranslations("marketplace");
  return price === 0 ? (
    <Badge variant="success" className={className} data-price="0">
      {t("free")}
    </Badge>
  ) : (
    <Badge variant="warning" className={className} data-price={price}>
      <Coins className="h-3.5 w-3.5" aria-hidden="true" />
      {t("tokens", { count: price })}
    </Badge>
  );
}

const STATUS_STYLE: Record<DocumentStatus, { variant: "warning" | "success" | "danger" | "neutral"; icon: LucideIcon }> = {
  PENDING_REVIEW: { variant: "warning", icon: Hourglass },
  PUBLISHED: { variant: "success", icon: CircleCheck },
  REJECTED: { variant: "danger", icon: XCircle },
  UNPUBLISHED: { variant: "neutral", icon: CircleSlash },
};

/** "Waiting for review", "Published", "Rejected", "Unpublished". */
export function StatusBadge({ status }: { status: DocumentStatus }) {
  const t = useTranslations("marketplace.status");
  const style = STATUS_STYLE[status] ?? STATUS_STYLE.PENDING_REVIEW;
  const Icon = style.icon;
  return (
    <Badge variant={style.variant} data-status-badge={status}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {t(status)}
    </Badge>
  );
}

/** "Course notes", "Summary", "Exercises"... */
export function TypeBadge({ type }: { type: DocumentType }) {
  const t = useTranslations("marketplace.types");
  const Icon = TYPE_ICONS[type] ?? FileQuestion;
  return (
    <Badge variant="secondary" data-type={type}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {t(type)}
    </Badge>
  );
}

/** Subject name with its timetable colour as a dot ("No subject" when it was deleted). */
export function SubjectBadge({ subject, className }: { subject: Subject | null | undefined; className?: string }) {
  const t = useTranslations("marketplace");
  const color = subject && SUBJECT_COLOR_RE.test(subject.color) ? subject.color : undefined;
  return (
    <Badge variant="outline" className={cn("max-w-full", className)} data-subject={subject?.code ?? ""}>
      <span
        aria-hidden="true"
        className={cn("h-2.5 w-2.5 shrink-0 rounded-full", !color && "bg-muted-foreground")}
        style={color ? { backgroundColor: color } : undefined}
      />
      <span className="truncate">{subject?.name ?? t("noSubject")}</span>
    </Badge>
  );
}

/** "Your document" (author) or "In your library" (bought / downloaded). */
export function OwnershipBadge({ mine, purchased }: { mine?: boolean; purchased?: boolean }) {
  const t = useTranslations("marketplace");
  if (mine) {
    return (
      <Badge variant="default" data-owned="mine">
        <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
        {t("yours")}
      </Badge>
    );
  }
  if (purchased) {
    return (
      <Badge variant="secondary" data-owned="library">
        <Library className="h-3.5 w-3.5" aria-hidden="true" />
        {t("inLibrary")}
      </Badge>
    );
  }
  return null;
}
