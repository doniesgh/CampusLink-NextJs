"use client";

import { CircleCheck, OctagonAlert, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { levelVariant } from "@/lib/analytics/paths";
import type { Level } from "@/lib/analytics/types";
import { cn } from "@/lib/utils";

const ICONS = { OK: CircleCheck, WARNING: TriangleAlert, CRITICAL: OctagonAlert } as const;

/** Absence level as a pill: icon + text (never color alone). `data-level` carries the raw value. */
export function LevelBadge({ level, className }: { level: Level; className?: string }) {
  const t = useTranslations("analytics.levels");
  const Icon = ICONS[level];
  return (
    <Badge variant={levelVariant(level)} className={className} data-level={level}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {t(level)}
    </Badge>
  );
}

/** Small colored dot of a subject (decorative: the subject name is always written next to it). */
export function SubjectDot({ color, className }: { color?: string | null; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-primary", className)}
      style={color && /^#[0-9a-f]{3,8}$/i.test(color) ? { backgroundColor: color } : undefined}
    />
  );
}

/** Subject name with its colour dot. */
export function SubjectLabel({ subject, className }: { subject: { name?: string; code?: string; color?: string } | null; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <SubjectDot color={subject?.color} />
      <span className="truncate">{subject?.name ?? subject?.code ?? "—"}</span>
    </span>
  );
}
