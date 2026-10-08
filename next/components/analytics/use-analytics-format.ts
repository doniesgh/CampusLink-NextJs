"use client";

import { useMemo } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { isDateKey, zonedTimeToUtc } from "@/lib/datetime";

/**
 * Number and date formatting of the analytics screens (campus timezone, current locale):
 * - percent(0.136) -> "13.6%" / "13,6 %"; grade(13.456) -> "13.46/20"; hours(2.5) -> "2.5 h";
 * - day("2026-10-08" | ISO) -> "Oct 8" / "8 oct."; longDay(...) -> "October 8, 2026".
 */
export function useAnalyticsFormat() {
  const format = useFormatter();
  const t = useTranslations("analytics.units");

  return useMemo(() => {
    const toDate = (value: string | Date) => {
      if (value instanceof Date) return value;
      // A calendar day: noon campus time, so it never shifts to the previous/next day.
      return isDateKey(value) ? zonedTimeToUtc(value, "12:00") : new Date(value);
    };
    const number = (value: number, digits = 2) => format.number(value, { maximumFractionDigits: digits });
    return {
      number,
      percent: (rate: number | null | undefined) =>
        typeof rate === "number" ? format.number(rate, { style: "percent", maximumFractionDigits: 1 }) : t("noValue"),
      grade: (value: number | null | undefined) => (typeof value === "number" ? t("grade", { value: number(value) }) : t("noValue")),
      score: (score: number | null | undefined, max: number) =>
        typeof score === "number" ? t("score", { score: number(score), max: number(max) }) : t("noValue"),
      hours: (value: number | null | undefined) => t("hours", { value: number(typeof value === "number" ? value : 0, 1) }),
      day: (value: string | Date) => format.dateTime(toDate(value), "dayMonth"),
      longDay: (value: string | Date) => format.dateTime(toDate(value), "date"),
      weekday: (value: string | Date) => format.dateTime(toDate(value), "weekdayLong"),
      dateTime: (value: string | Date) => format.dateTime(toDate(value), "dateTime"),
      time: (value: string | Date) => format.dateTime(toDate(value), "time"),
      list: (values: string[]) => format.list(values, { type: "conjunction" }),
    };
  }, [format, t]);
}

export type AnalyticsFormat = ReturnType<typeof useAnalyticsFormat>;
