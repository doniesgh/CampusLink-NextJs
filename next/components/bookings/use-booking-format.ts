"use client";

import { useMemo } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { formatTimeRange } from "@/lib/datetime";
import { minutesOf } from "@/lib/bookings/rules";

/**
 * Date/time labels of the bookings pages (campus timezone, 24h):
 *   when(startsAt, endsAt) -> "Fri, Oct 9, 16:30–18:30" / "ven. 9 oct., 16:30–18:30"
 */
export function useBookingFormat() {
  const format = useFormatter();
  const t = useTranslations("bookings.format");
  return useMemo(
    () => ({
      day: (value: string | number | Date) => format.dateTime(new Date(value), "weekdayDayMonth"),
      when: (startsAt: string | number, endsAt: string | number) =>
        t("when", { day: format.dateTime(new Date(startsAt), "weekdayDayMonth"), range: formatTimeRange(startsAt, endsAt) }),
      range: (startsAt: string | number, endsAt: string | number) => formatTimeRange(startsAt, endsAt),
      dateTime: (value: string | number) => format.dateTime(new Date(value), "dayMonthTime"),
      /** "1 h 30 min" from two "HH:mm" times (empty when invalid). */
      duration: (start: string, end: string) => {
        const total = minutesOf(end) - minutesOf(start);
        if (!Number.isFinite(total) || total <= 0) return "";
        const hours = Math.floor(total / 60);
        const minutes = total % 60;
        if (hours === 0) return t("minutes", { minutes });
        return minutes === 0 ? t("hours", { hours }) : t("hoursMinutes", { hours, minutes });
      },
    }),
    [format, t]
  );
}
