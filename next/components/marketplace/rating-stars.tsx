"use client";

import { useState } from "react";
import { Star, StarHalf } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRatingValue } from "@/components/marketplace/use-market-format";
import { RATINGS } from "@/lib/marketplace/types";
import { cn } from "@/lib/utils";

/** Five stars for an average (halves from .25 to .75), drawn only (the caller gives the text). */
function Stars({ rating, starClass }: { rating: number; starClass: string }) {
  const rounded = Math.round(rating * 2) / 2;
  return (
    <span className="inline-flex items-center" aria-hidden="true">
      {RATINGS.map((value) => {
        if (rounded >= value) return <Star key={value} className={cn(starClass, "fill-highlight text-highlight")} />;
        if (rounded >= value - 0.5) {
          return (
            <span key={value} className="relative inline-flex">
              <Star className={cn(starClass, "text-muted-foreground/60")} />
              <StarHalf className={cn(starClass, "absolute left-0 top-0 fill-highlight text-highlight")} />
            </span>
          );
        }
        return <Star key={value} className={cn(starClass, "text-muted-foreground/60")} />;
      })}
    </span>
  );
}

/**
 * Average rating: stars + "4.5" + "(12)", one accessible name ("Rated 4.5 out of 5, 12 reviews").
 * Without reviews: "No reviews yet".
 */
export function RatingStars({ rating, count, size = "sm", className }: { rating: number; count: number; size?: "sm" | "lg"; className?: string }) {
  const t = useTranslations("marketplace.rating");
  const value = useRatingValue();
  if (count === 0) {
    return <span className={cn("text-xs text-muted-foreground", className)}>{t("none")}</span>;
  }
  return (
    <span
      role="img"
      aria-label={t("label", { rating: value(rating), count })}
      className={cn("inline-flex items-center gap-1.5", className)}
      data-rating={rating}
    >
      <Stars rating={rating} starClass={size === "lg" ? "h-5 w-5" : "h-3.5 w-3.5"} />
      <span className={cn("font-semibold text-foreground", size === "lg" ? "text-base" : "text-xs")}>{value(rating)}</span>
      <span className={cn("text-muted-foreground", size === "lg" ? "text-sm" : "text-xs")}>({count})</span>
    </span>
  );
}

/** One review's stars ("4 out of 5 stars"). */
export function ReviewStars({ rating }: { rating: number }) {
  const t = useTranslations("marketplace.rating");
  return (
    <span role="img" aria-label={t("stars", { rating })} className="inline-flex">
      <Stars rating={rating} starClass="h-4 w-4" />
    </span>
  );
}

/**
 * Rating input: five native radio buttons drawn as stars (arrow keys move, Space selects), in a fieldset whose
 * legend is the label. Each radio is named "<n> star(s)".
 */
export function RatingInput({
  name,
  legend,
  value,
  onChange,
  error,
  errorId,
  disabled,
}: {
  name: string;
  legend: string;
  value: number;
  onChange: (value: number) => void;
  error?: string;
  errorId?: string;
  disabled?: boolean;
}) {
  const t = useTranslations("marketplace.rating");
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value;
  return (
    <fieldset className="space-y-2" disabled={disabled} aria-describedby={error ? errorId : undefined}>
      <legend className="text-sm font-medium leading-none">{legend}</legend>
      <div className="flex items-center gap-1" onMouseLeave={() => setHover(null)}>
        {RATINGS.map((rating) => (
          <label
            key={rating}
            className={cn(
              "cursor-pointer rounded-lg p-0.5 transition-transform hover:scale-110",
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
              disabled && "cursor-not-allowed opacity-50 hover:scale-100"
            )}
            onMouseEnter={() => !disabled && setHover(rating)}
          >
            <input
              type="radio"
              name={name}
              value={rating}
              checked={value === rating}
              onChange={() => onChange(rating)}
              className="sr-only"
            />
            <Star
              className={cn("h-7 w-7", rating <= shown ? "fill-highlight text-highlight" : "text-muted-foreground")}
              aria-hidden="true"
            />
            <span className="sr-only">{t("stars", { rating })}</span>
          </label>
        ))}
        <span className="ml-2 text-sm text-muted-foreground" aria-hidden="true">
          {shown > 0 ? t(`words.${shown as 1 | 2 | 3 | 4 | 5}`) : ""}
        </span>
      </div>
      {error && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}
