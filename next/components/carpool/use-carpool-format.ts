"use client";

import { useMemo } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { addDays, dateKey } from "@/lib/datetime";

type Named = { firstname?: string | null; lastname?: string | null } | null | undefined;

/**
 * Carpool wording shared by the views: prices in dinars, distances, "Today · 07:45", names. Dates and times are
 * in the campus timezone (next-intl formatter). `now` (ms) decides what "today" and "tomorrow" are.
 */
export function useCarpoolFormat() {
  const format = useFormatter();
  const t = useTranslations("carpool.format");
  return useMemo(() => {
    const number = (value: number, digits: number) => format.number(value, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
    const day = (iso: string, now: number) => {
      const key = dateKey(iso);
      const today = dateKey(now);
      if (key === today) return t("today");
      if (key === addDays(today, 1)) return t("tomorrow");
      return format.dateTime(new Date(iso), "weekdayDayMonth");
    };
    const time = (iso: string) => format.dateTime(new Date(iso), "time");
    return {
      /** "2.5 DT" or "Free". */
      price: (value: number) => (value === 0 ? t("free") : t("price", { price: number(value, 3) })),
      /** "2.5 DT / seat" or "Free". */
      pricePerSeat: (value: number) => (value === 0 ? t("free") : t("pricePerSeat", { price: number(value, 3) })),
      km: (value: number) => number(value, 1),
      rating: (value: number) => number(value, 1),
      day,
      time,
      /** "Tomorrow · 07:45". */
      when: (iso: string, now: number) => t("dayTime", { day: day(iso, now), time: time(iso) }),
      /** "Oct 7, 10:42". */
      dateTime: (iso: string) => format.dateTime(new Date(iso), "dayMonthTime"),
      name: (person: Named) => `${person?.firstname ?? ""} ${person?.lastname ?? ""}`.trim() || t("someone"),
    };
  }, [format, t]);
}

export type CarpoolFormat = ReturnType<typeof useCarpoolFormat>;
