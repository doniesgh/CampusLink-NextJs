import { ArrowDown, ArrowUp, CircleCheck, Clock, PencilLine, Siren } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { AnnouncementStatus, Priority } from "@/lib/announcements/types";

const PRIORITY_VARIANTS: Record<Priority, NonNullable<BadgeProps["variant"]>> = {
  URGENT: "danger",
  HIGH: "warning",
  NORMAL: "secondary",
  LOW: "neutral",
};

const PRIORITY_ICONS: Partial<Record<Priority, typeof Siren>> = {
  URGENT: Siren,
  HIGH: ArrowUp,
  LOW: ArrowDown,
};

/** Pill with the priority label ("Urgent", "High", "Normal", "Low"); icon + text, never color alone. */
export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  const t = useTranslations("announcements.priority");
  const Icon = PRIORITY_ICONS[priority];
  return (
    <Badge variant={PRIORITY_VARIANTS[priority] ?? "secondary"} className={className} data-priority={priority}>
      {Icon && <Icon className="h-3 w-3" aria-hidden="true" />}
      {t(priority)}
    </Badge>
  );
}

const STATUS_VARIANTS: Record<AnnouncementStatus, NonNullable<BadgeProps["variant"]>> = {
  DRAFT: "neutral",
  SCHEDULED: "warning",
  PUBLISHED: "success",
};

const STATUS_ICONS: Record<AnnouncementStatus, typeof Clock> = {
  DRAFT: PencilLine,
  SCHEDULED: Clock,
  PUBLISHED: CircleCheck,
};

/** Pill with the publication status ("Draft", "Scheduled", "Published"). */
export function StatusBadge({ status, className }: { status: AnnouncementStatus; className?: string }) {
  const t = useTranslations("announcements.status");
  const Icon = STATUS_ICONS[status];
  return (
    <Badge variant={STATUS_VARIANTS[status] ?? "neutral"} className={className} data-status={status}>
      {Icon && <Icon className="h-3 w-3" aria-hidden="true" />}
      {t(status)}
    </Badge>
  );
}

/** "New" pill for unread announcements. */
export function NewBadge() {
  const t = useTranslations("common.states");
  return <Badge variant="highlight">{t("new")}</Badge>;
}
