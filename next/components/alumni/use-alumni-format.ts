import { useFormatter, useTranslations } from "next-intl";
import { APP_TIMEZONE } from "@/lib/datetime";
import { fullName } from "@/lib/alumni/types";

function yearIn(date: Date): string {
  return new Intl.DateTimeFormat("en", { timeZone: APP_TIMEZONE, year: "numeric" }).format(date);
}

const toDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Dates of the alumni pages, in the campus timezone. */
export function useAlumniFormat() {
  const format = useFormatter();
  return {
    /** "October 7, 2026". */
    date: (value: string | null | undefined): string | null => {
      const date = toDate(value);
      return date ? format.dateTime(date, "date") : null;
    },
    /** "Oct 7, 10:42" this year, "Oct 7, 2025, 10:42" otherwise. */
    dateTime: (value: string | null | undefined): string | null => {
      const date = toDate(value);
      if (!date) return null;
      return format.dateTime(date, yearIn(date) === yearIn(new Date()) ? "dayMonthTime" : "dateTime");
    },
  };
}

/** "Selim Rekik", or "Deleted profile" once that person erased their data. */
export function useDisplayName(): (user: { firstname?: string | null; lastname?: string | null } | null | undefined) => string {
  const t = useTranslations("alumni");
  return (user) => fullName(user) || t("deletedProfile");
}
