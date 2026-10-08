"use client";

import { Cigarette, CigaretteOff, Music, PawPrint, School, Star, Venus, VolumeX } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { useCarpoolFormat } from "@/components/carpool/use-carpool-format";
import { cn } from "@/lib/utils";
import type { Direction, PersonRating, RequestStatus, TripPreferences, TripStatus } from "@/lib/carpool/types";

const TRIP_VARIANTS: Record<TripStatus, BadgeProps["variant"]> = {
  OPEN: "success",
  FULL: "warning",
  CANCELLED: "danger",
  COMPLETED: "neutral",
};

const REQUEST_VARIANTS: Record<RequestStatus, BadgeProps["variant"]> = {
  PENDING: "warning",
  ACCEPTED: "success",
  DECLINED: "danger",
  CANCELLED: "neutral",
  EXPIRED: "neutral",
};

export function TripStatusBadge({ status }: { status: TripStatus }) {
  const t = useTranslations("carpool.statuses");
  return (
    <Badge variant={TRIP_VARIANTS[status] ?? "neutral"} data-status={status}>
      {t(status)}
    </Badge>
  );
}

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const t = useTranslations("carpool.requestStatuses");
  return (
    <Badge variant={REQUEST_VARIANTS[status] ?? "neutral"} data-request-status={status}>
      {t(status)}
    </Badge>
  );
}

export function DirectionBadge({ direction }: { direction: Direction }) {
  const t = useTranslations("carpool.directions");
  return (
    <Badge variant="secondary" data-direction={direction}>
      <School className="h-3.5 w-3.5" aria-hidden="true" />
      {t(direction)}
    </Badge>
  );
}

/** "★ 4.7 (12)" with a full sentence for screen readers, or "No ratings yet". */
export function RatingText({ rating, className }: { rating: PersonRating; className?: string }) {
  const t = useTranslations("carpool.format");
  const format = useCarpoolFormat();
  if (rating.rating === null || rating.ratingCount === 0) {
    return <span className={cn("text-muted-foreground", className)}>{t("noRating")}</span>;
  }
  return (
    <span className={cn("inline-flex items-center gap-1", className)} data-rating={rating.rating}>
      <Star className="h-3.5 w-3.5 fill-highlight text-highlight" aria-hidden="true" />
      <span aria-hidden="true">
        {format.rating(rating.rating)} <span className="text-muted-foreground">({rating.ratingCount})</span>
      </span>
      <span className="sr-only">{t("ratingLabel", { rating: format.rating(rating.rating), count: rating.ratingCount })}</span>
    </span>
  );
}

/** Small chips for the driver's preferences (music, smoking, pets, women only). */
export function PreferenceChips({ preferences, className }: { preferences: TripPreferences; className?: string }) {
  const t = useTranslations("carpool.preferences");
  const chips = [
    preferences.music ? { key: "music", icon: Music, label: t("music") } : { key: "noMusic", icon: VolumeX, label: t("noMusic") },
    preferences.smoking ? { key: "smoking", icon: Cigarette, label: t("smoking") } : { key: "noSmoking", icon: CigaretteOff, label: t("noSmoking") },
    ...(preferences.pets ? [{ key: "pets", icon: PawPrint, label: t("pets") }] : []),
    ...(preferences.womenOnly ? [{ key: "womenOnly", icon: Venus, label: t("womenOnly") }] : []),
  ];
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} aria-label={t("label")}>
      {chips.map(({ key, icon: Icon, label }) => (
        <li key={key} data-preference={key}>
          <Badge variant="outline" className="font-medium">
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
