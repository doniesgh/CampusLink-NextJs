"use client";

import { useTranslations } from "next-intl";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS_TICK, CHART_TOKENS, ChartTable, Swatch, TooltipBox } from "@/components/analytics/chart-parts";
import { useAnalyticsFormat } from "@/components/analytics/use-analytics-format";
import type { ActivityWeek } from "@/lib/analytics/types";
import { cn } from "@/lib/utils";

type SeriesKey = "announcementsRead" | "forumQuestions" | "forumAnswers";

/** Fixed order: the colour follows the series, whatever the data. */
const SERIES: { key: SeriesKey; color: string }[] = [
  { key: "announcementsRead", color: "var(--chart-1)" },
  { key: "forumQuestions", color: "var(--chart-2)" },
  { key: "forumAnswers", color: "var(--chart-3)" },
];

const total = (week: ActivityWeek) => week.announcementsRead + week.forumQuestions + week.forumAnswers;

/**
 * Activity of the last 12 weeks as stacked columns (announcements read, forum questions, forum answers), with a
 * legend above the plot, a 2px surface gap between segments, a hover tooltip, a text summary and a table.
 */
export function ActivityChart({ weeks }: { weeks: ActivityWeek[] }) {
  const t = useTranslations("analytics.overview.activity");
  const fmt = useAnalyticsFormat();

  const sums = weeks.reduce(
    (acc, week) => ({
      questions: acc.questions + week.forumQuestions,
      answers: acc.answers + week.forumAnswers,
      reads: acc.reads + week.announcementsRead,
    }),
    { questions: 0, answers: 0, reads: 0 }
  );
  const all = sums.questions + sums.answers + sums.reads;
  const summary = t("summary", { total: all, ...sums });
  const peak = Math.max(0, ...weeks.map(total));

  return (
    <figure className={cn("space-y-3", CHART_TOKENS)} data-chart="activity">
      <figcaption className="text-sm text-muted-foreground">{summary}</figcaption>
      <ul aria-label={t("legend")} className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground">
        {SERIES.map((series) => (
          <li key={series.key} className="flex items-center gap-1.5">
            <Swatch color={series.color} />
            {t(series.key)}
          </li>
        ))}
      </ul>
      <div role="img" aria-label={summary}>
        <BarChart
          responsive
          accessibilityLayer={false}
          style={{ width: "100%", height: 220 }}
          data={weeks}
          margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
          barCategoryGap="25%"
        >
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="week"
            tickFormatter={(value: string) => fmt.day(value)}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            minTickGap={12}
          />
          <YAxis
            allowDecimals={false}
            domain={[0, peak > 0 ? "auto" : 4]}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={28}
          />
          <Tooltip
            cursor={{ fill: "var(--accent)" }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const week = active ? (payload?.[0]?.payload as ActivityWeek | undefined) : undefined;
              if (!week) return null;
              return (
                <TooltipBox title={t("weekOf", { date: fmt.day(week.week) })}>
                  {SERIES.map((series) => (
                    <p key={series.key} className="flex items-center gap-2">
                      <Swatch color={series.color} />
                      <span>{t(series.key)}</span>
                      <span className="ml-auto pl-3 font-semibold tabular-nums">{fmt.number(week[series.key])}</span>
                    </p>
                  ))}
                </TooltipBox>
              );
            }}
          />
          {SERIES.map((series, index) => (
            <Bar
              key={series.key}
              dataKey={series.key}
              stackId="activity"
              fill={series.color}
              stroke="var(--card)"
              strokeWidth={2}
              maxBarSize={24}
              isAnimationActive={false}
              radius={index === SERIES.length - 1 ? [4, 4, 0, 0] : 0}
            />
          ))}
        </BarChart>
      </div>
      <ChartTable
        summary={t("showTable")}
        caption={t("tableCaption")}
        head={[t("week"), t("announcementsRead"), t("forumQuestions"), t("forumAnswers"), t("total")]}
        rows={weeks.map((week) => ({
          key: week.week,
          cells: [
            t("weekOf", { date: fmt.day(week.week) }),
            fmt.number(week.announcementsRead),
            fmt.number(week.forumQuestions),
            fmt.number(week.forumAnswers),
            fmt.number(total(week)),
          ],
        }))}
      />
    </figure>
  );
}
