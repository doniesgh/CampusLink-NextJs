import {
  Archive,
  Briefcase,
  CalendarDays,
  CircleCheck,
  CircleX,
  EyeOff,
  Globe,
  Handshake,
  Hourglass,
  Lock,
  Megaphone,
  MessageSquare,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { MentoringStatus, PostType, Visibility } from "@/lib/alumni/types";

// Pills of the alumni network (Server and Client Components; Client Components need the "alumni" messages).
// Every pill has an icon and a word: colour is never the only signal.

/** "Open to mentoring". */
export function MentoringBadge() {
  const t = useTranslations("alumni.badges");
  return (
    <Badge variant="success" data-badge="mentoring">
      <Handshake className="h-3.5 w-3.5" aria-hidden="true" />
      {t("mentoring")}
    </Badge>
  );
}

const STATUS_STYLE: Record<MentoringStatus, { icon: LucideIcon; variant: BadgeProps["variant"] }> = {
  PENDING: { icon: Hourglass, variant: "warning" },
  ACCEPTED: { icon: CircleCheck, variant: "success" },
  DECLINED: { icon: CircleX, variant: "neutral" },
  CLOSED: { icon: Archive, variant: "neutral" },
};

/** Status of a mentoring request: "Pending", "Accepted", "Declined", "Closed". */
export function RequestStatusBadge({ status }: { status: MentoringStatus }) {
  const t = useTranslations("alumni.status");
  const { icon: Icon, variant } = STATUS_STYLE[status] ?? STATUS_STYLE.CLOSED;
  return (
    <Badge variant={variant} data-request-status={status}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {t(status)}
    </Badge>
  );
}

const POST_ICONS: Record<PostType, LucideIcon> = {
  NEW_JOB: Briefcase,
  ACHIEVEMENT: Trophy,
  OPPORTUNITY: Megaphone,
  EVENT: CalendarDays,
  OTHER: MessageSquare,
};

/** Type of a news post: "New job", "Achievement", "Opportunity", "Event", "Other". */
export function PostTypeBadge({ type }: { type: PostType }) {
  const t = useTranslations("alumni.postTypes");
  const Icon = POST_ICONS[type] ?? MessageSquare;
  return (
    <Badge variant="secondary" data-post-type={type}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {t(type)}
    </Badge>
  );
}

/** "Visible to the campus" / "Private". */
export function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  const t = useTranslations("alumni.badges");
  return visibility === "CAMPUS" ? (
    <Badge variant="success" data-visibility="CAMPUS">
      <Globe className="h-3.5 w-3.5" aria-hidden="true" />
      {t("campus")}
    </Badge>
  ) : (
    <Badge variant="neutral" data-visibility="PRIVATE">
      <Lock className="h-3.5 w-3.5" aria-hidden="true" />
      {t("private")}
    </Badge>
  );
}

/** Post hidden by the moderation team (only ADMINs and its author receive it). */
export function HiddenBadge() {
  const t = useTranslations("alumni.badges");
  return (
    <Badge variant="danger" data-badge="hidden">
      <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
      {t("hidden")}
    </Badge>
  );
}
