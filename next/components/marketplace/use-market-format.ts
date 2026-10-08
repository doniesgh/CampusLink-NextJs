"use client";

import { useFormatter, useTranslations } from "next-intl";
import { APP_TIMEZONE } from "@/lib/datetime";
import type { MarketPerson } from "@/lib/marketplace/types";
import type { MarketValidationError } from "@/lib/marketplace/validation";

// Formatting shared by the marketplace components (Client Components with the "marketplace" messages).
export { useDateTimeLabel } from "@/components/announcements/use-format";
export { useFileSize } from "@/components/announcements/attachment-list";

/** "Yasmine Haddad", or "Former member" when the account is gone. */
export function usePersonName(): (person: MarketPerson | undefined) => string {
  const t = useTranslations("marketplace");
  return (person) => {
    const name = person ? `${person.firstname ?? ""} ${person.lastname ?? ""}`.trim() : "";
    return name || t("unknownPerson");
  };
}

/** "4.5" / "4,5" (one decimal at most). */
export function useRatingValue(): (rating: number) => string {
  const format = useFormatter();
  return (rating) => format.number(Math.round(rating * 10) / 10, { maximumFractionDigits: 1, minimumFractionDigits: 0 });
}

/** Extension in capitals ("PDF") of a file name, "" without one. */
export function extensionLabel(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot + 1).toUpperCase() : "";
}

/** Translates a `lib/marketplace/validation` error (null stays null). */
export function useValidationMessage(): (error: MarketValidationError | null) => string | null {
  const t = useTranslations("marketplace.validation");
  return (error) => (error ? t(error.key, error.values) : null);
}

/** "Oct 7" this year, "October 7, 2025" otherwise (campus timezone): publication and review dates. */
export function useDateLabel(): (value: string | null | undefined) => string | null {
  const format = useFormatter();
  return (value) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const year = (d: Date) => new Intl.DateTimeFormat("en", { timeZone: APP_TIMEZONE, year: "numeric" }).format(d);
    return format.dateTime(date, year(date) === year(new Date()) ? "dayMonth" : "date");
  };
}
