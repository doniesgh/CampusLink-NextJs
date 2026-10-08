"use client";

import { Ban, CircleCheck, CircleX, Clock3 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { BookingStatus } from "@/lib/bookings/types";

const VARIANTS: Record<BookingStatus, BadgeProps["variant"]> = {
  PENDING: "warning",
  CONFIRMED: "success",
  REJECTED: "danger",
  CANCELLED: "neutral",
};

const ICONS = { PENDING: Clock3, CONFIRMED: CircleCheck, REJECTED: CircleX, CANCELLED: Ban } as const;

/** "Pending" / "Confirmed" / "Rejected" / "Cancelled" with an icon (never color alone). */
export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const t = useTranslations("bookings.statuses");
  const Icon = ICONS[status] ?? Clock3;
  return (
    <Badge variant={VARIANTS[status] ?? "neutral"}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {t(status)}
    </Badge>
  );
}
