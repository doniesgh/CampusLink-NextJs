"use client";

import { useTranslations } from "next-intl";
import { CartesianGrid, LabelList, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS_TICK, CHART_TOKENS, ChartTable, Swatch, TooltipBox } from "@/components/analytics/chart-parts";
import { useAnalyticsFormat } from "@/components/analytics/use-analytics-format";
import { cn } from "@/lib/utils";

type Point = { date: string; average: number };

/**
 * Overall average (out of 20) after each graded assessment: one series (no legend, the title names it), the latest
 * value labelled at the end of the line, an optional "Group average" reference line (opt-in comparison). The text
 * summary and the table give the same information without the chart.
 */
export function ProgressChart({
  trend,
  groupAverage,
}: {
  trend: { date: string; average: number | null }[];
  groupAverage?: number | null;
}) {
  const t = useTranslations("analytics.overview.progress");
  const fmt = useAnalyticsFormat();
  const points: Point[] = trend.filter((point): point is Point => typeof point.average === "number");

  if (points.length === 0) return <p className="text-sm text-muted-foreground">{t("empty")}</p>;

  const first = points[0];
  const last = points[points.length - 1];
  const summary =
    points.length === 1
      ? t("summaryOne", { value: fmt.grade(last.average), date: fmt.longDay(last.date) })
      : t("summary", { first: fmt.grade(first.average), from: fmt.longDay(first.date), last: fmt.grade(last.average), to: fmt.longDay(last.date) });
  const hasGroup = typeof groupAverage === "number";

  return (
    <figure className={cn("space-y-3", CHART_TOKENS)} data-chart="progress">
      <figcaption className="text-sm text-muted-foreground">
        {summary}
        {hasGroup && ` ${t("groupAverage", { value: fmt.grade(groupAverage) })}.`}
      </figcaption>
      <div role="img" aria-label={summary} className="text-foreground">
        <LineChart
          responsive
          accessibilityLayer={false}
          style={{ width: "100%", height: 240 }}
          data={points}
          margin={{ top: 20, right: 28, bottom: 4, left: 0 }}
        >
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="date"
            tickFormatter={(value: string) => fmt.day(value)}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            minTickGap={24}
            padding={{ left: 12, right: 12 }}
          />
          <YAxis domain={[0, 20]} ticks={[0, 5, 10, 15, 20]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={32} />
          {hasGroup && (
            <ReferenceLine
              y={groupAverage}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              ifOverflow="extendDomain"
              label={{ value: t("groupAverage", { value: fmt.grade(groupAverage) }), position: "insideBottomLeft", fill: "var(--muted-foreground)", fontSize: 12 }}
            />
          )}
          <Tooltip
            cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const point = active ? (payload?.[0]?.payload as Point | undefined) : undefined;
              if (!point) return null;
              return (
                <TooltipBox title={fmt.longDay(point.date)}>
                  <p className="flex items-center gap-2">
                    <Swatch color="var(--chart-1)" />
                    <span>{t("average")}</span>
                    <span className="ml-auto pl-3 font-semibold tabular-nums">{fmt.grade(point.average)}</span>
                  </p>
                </TooltipBox>
              );
            }}
          />
          <Line
            type="linear"
            dataKey="average"
            stroke="var(--chart-1)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            isAnimationActive={false}
            dot={{ r: 4, fill: "var(--chart-1)", stroke: "var(--card)", strokeWidth: 2 }}
            activeDot={{ r: 6, fill: "var(--chart-1)", stroke: "var(--card)", strokeWidth: 2 }}
          >
            <LabelList
              dataKey="average"
              content={(props) =>
                props.index === points.length - 1 ? (
                  <text
                    x={Number(props.x)}
                    y={Number(props.y) - 12}
                    textAnchor="middle"
                    fill="var(--foreground)"
                    fontSize={12}
                    fontWeight={600}
                  >
                    {fmt.number(last.average)}
                  </text>
                ) : null
              }
            />
          </Line>
        </LineChart>
      </div>
      <ChartTable
        summary={t("showTable")}
        caption={t("tableCaption")}
        head={[t("date"), t("average")]}
        rows={points.map((point) => ({ key: point.date, cells: [fmt.longDay(point.date), fmt.grade(point.average)] }))}
      />
    </figure>
  );
}
