"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { zonedTimeToUtc } from "@/lib/datetime";
import { cn } from "@/lib/utils";

/** Days shown in the chart (the table lists the same days). */
const MAX_DAYS = 30;

type Day = { date: string; count: number };

/** 0, then a clean top value (1, 2, 5, 10, 20, 50...) at or above the max. */
function niceMax(max: number): number {
  if (max <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 5, 10]) {
    if (step * magnitude >= max) return step * magnitude;
  }
  return 10 * magnitude;
}

/**
 * "Reads by day" column chart (single series in the primary color, no legend: the title names it).
 * Each column shows its date and count on hover; the same numbers are in the table below
 * ("Show as a table"), so nothing depends on hovering. Days are campus-timezone dates.
 */
export function ReadsChart({ days }: { days: Day[] }) {
  const t = useTranslations("announcements.stats.chart");
  const format = useFormatter();
  const [active, setActive] = useState<number | null>(null);

  const shown = days.slice(-MAX_DAYS);
  const dayLabel = (date: string) => format.dateTime(zonedTimeToUtc(date, "12:00"), "dayMonth");
  const longLabel = (date: string) => format.dateTime(zonedTimeToUtc(date, "12:00"), "weekdayDayMonth");

  if (shown.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }

  const total = shown.reduce((sum, day) => sum + day.count, 0);
  const peak = shown.reduce((best, day) => (day.count > best.count ? day : best), shown[0]);
  const top = niceMax(peak.count);
  const ticks = top >= 2 && top % 2 === 0 ? [top, top / 2, 0] : [top, 0];
  const summary =
    total === 0
      ? t("summaryNone", { days: shown.length })
      : t("summary", { total, days: shown.length, peakDate: longLabel(peak.date), peak: peak.count });
  const labelEvery = Math.max(1, Math.ceil(shown.length / 6));

  return (
    <figure className="space-y-3">
      {days.length > MAX_DAYS && <figcaption className="text-xs text-muted-foreground">{t("lastDays", { days: MAX_DAYS })}</figcaption>}
      <div className="flex gap-2">
        {/* Y axis */}
        <div className="relative h-44 w-7 shrink-0 text-right text-xs tabular-nums text-muted-foreground" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} className="absolute right-0 -translate-y-1/2" style={{ top: `${100 - (tick / top) * 100}%` }}>
              {format.number(tick)}
            </span>
          ))}
        </div>
        {/* Plot */}
        <div className="relative min-w-0 flex-1">
          <div role="img" aria-label={summary} className="relative h-44">
            {ticks.map((tick) => (
              <span key={tick} aria-hidden="true" className="absolute inset-x-0 h-px bg-border" style={{ top: `${100 - (tick / top) * 100}%` }} />
            ))}
            <div className="absolute inset-0 flex items-end gap-[2px]" onPointerLeave={() => setActive(null)}>
              {shown.map((day, index) => {
                const height = (day.count / top) * 100;
                return (
                  <div
                    key={day.date}
                    className="relative flex h-full min-w-0 flex-1 items-end justify-center"
                    onPointerEnter={() => setActive(index)}
                  >
                    {day.count > 0 && (
                      <span
                        className={cn(
                          "block w-full max-w-6 rounded-t-[4px] bg-primary transition-opacity",
                          active !== null && active !== index && "opacity-60"
                        )}
                        style={{ height: `${height}%` }}
                      />
                    )}
                    {/* Direct label on the busiest day only (the table has every value). */}
                    {day === peak && day.count > 0 && active === null && (
                      <span
                        aria-hidden="true"
                        className="absolute text-xs font-semibold tabular-nums text-foreground"
                        style={{ bottom: `calc(${height}% + 4px)` }}
                      >
                        {format.number(day.count)}
                      </span>
                    )}
                    {active === index && (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-xl border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-lg",
                          index > shown.length / 2 ? "right-0" : "left-0"
                        )}
                      >
                        <span className="block text-sm font-semibold tabular-nums">{t("reads", { count: day.count })}</span>
                        <span className="block text-muted-foreground">{longLabel(day.date)}</span>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {/* X axis */}
          <div className="mt-2 flex gap-[2px] text-[11px] text-muted-foreground" aria-hidden="true">
            {shown.map((day, index) => (
              <span key={day.date} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">
                {index % labelEvery === 0 || index === shown.length - 1 ? dayLabel(day.date) : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      <details className="rounded-2xl border bg-background px-4 py-2 text-sm">
        <summary className="cursor-pointer font-medium text-foreground">{t("showTable")}</summary>
        <table className="mt-2 w-full text-left">
          <caption className="sr-only">{t("tableCaption")}</caption>
          <thead>
            <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="py-1.5 font-semibold">
                {t("date")}
              </th>
              <th scope="col" className="py-1.5 text-right font-semibold">
                {t("count")}
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((day) => (
              <tr key={day.date} className="border-b last:border-0">
                <td className="py-1.5">{longLabel(day.date)}</td>
                <td className="py-1.5 text-right tabular-nums">{format.number(day.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
