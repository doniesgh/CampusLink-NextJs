"use client";

import { useSyncExternalStore } from "react";
import { ChartBar, ChevronLeft, ChevronRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BookingStatusBadge } from "@/components/bookings/status-badge";
import Link from "@/components/ui/app-link";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BOOKING_STATUSES, type BookingStats, type ResourceUsage } from "@/lib/bookings/types";
import { cn } from "@/lib/utils";

/** Resources shown in the chart (all of them are in the table). */
const CHART_LIMIT = 10;
const ROW_HEIGHT = 36;
/** Occupancy rates are often small: one decimal ("4.2%"). */
const PERCENT = { style: "percent", maximumFractionDigits: 1 } as const;

/** A clean top of the axis at or above `value` (0..1): 1%, 2%, 2.5%, 5%, 10%... (at least 1%, at most 100%). */
function niceMax(value: number): number {
  const target = Math.min(1, Math.max(0.01, value));
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= target - 1e-9) ?? 10;
  return Math.min(1, step * magnitude);
}

const noop = () => () => {};
/** false on the server and during hydration, true afterwards (the chart measures the page). */
function useMounted(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-3xl border bg-card p-4 text-card-foreground">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-foreground">{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) {
  const t = useTranslations("bookings.admin.stats");
  const format = useFormatter();
  const item = payload?.[0]?.payload as ResourceUsage | undefined;
  if (!active || !item) return null;
  return (
    <div className="rounded-xl border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <p className="text-sm font-semibold">{item.name}</p>
      <p className="tabular-nums">{t("tooltipOccupancy", { rate: format.number(item.occupancyRate, PERCENT) })}</p>
      <p className="tabular-nums text-muted-foreground">
        {t("tooltipDetails", { bookings: item.bookings, hours: format.number(item.bookedHours, { maximumFractionDigits: 1 }) })}
      </p>
    </div>
  );
}

/** "Occupancy by resource": horizontal bars (single series, primary token), value at the tip, hover tooltip. */
function OccupancyChart({ resources, summary }: { resources: ResourceUsage[]; summary: string }) {
  const t = useTranslations("bookings.admin.stats");
  const format = useFormatter();
  const mounted = useMounted();
  const data = resources.slice(0, CHART_LIMIT);
  const height = Math.max(160, data.length * ROW_HEIGHT + 48);
  const domainMax = niceMax(Math.max(...data.map((item) => item.occupancyRate)));
  const percent = (value: number) => format.number(value, PERCENT);

  return (
    <figure className="space-y-2">
      <figcaption className="text-sm text-muted-foreground">{summary}</figcaption>
      <div
        className={cn(
          "text-primary",
          "[&_.recharts-cartesian-axis-tick-value]:fill-muted-foreground [&_.recharts-cartesian-axis-tick-value]:text-xs",
          "[&_.recharts-cartesian-grid_line]:stroke-border [&_.recharts-label-list_text]:fill-foreground [&_.recharts-label-list_text]:text-xs",
          "[&_.recharts-tooltip-cursor]:fill-muted [&_svg]:outline-none"
        )}
        style={{ height }}
      >
        {mounted ? (
          <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 600, height }}>
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 4, right: 48, bottom: 4, left: 4 }}
              barCategoryGap={8}
              title={t("chartTitle")}
              desc={summary}
            >
              <CartesianGrid horizontal={false} strokeWidth={1} />
              <XAxis type="number" domain={[0, domainMax]} ticks={[0, domainMax / 2, domainMax]} tickFormatter={percent} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" width={130} tickLine={false} axisLine={false} interval={0} />
              <Tooltip content={(props) => <ChartTooltip active={props.active} payload={props.payload} />} cursor={{ fillOpacity: 0.6 }} isAnimationActive={false} />
              <Bar dataKey="occupancyRate" fill="currentColor" radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={false}>
                <LabelList dataKey="occupancyRate" position="right" formatter={(value: unknown) => (typeof value === "number" ? percent(value) : "")} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : null}
      </div>
    </figure>
  );
}

/**
 * Usage statistics of a month: totals (requests by status, booked hours, average occupancy), the occupancy
 * chart (recharts) and the same numbers as a table. Occupancy = confirmed hours / opening hours (Mon-Sat
 * 07:00-21:00).
 */
export function UsageStats({
  stats,
  periodLabel,
  previousHref,
  nextHref,
}: {
  stats: BookingStats;
  periodLabel: string;
  previousHref: string;
  nextHref: string;
}) {
  const t = useTranslations("bookings.admin.stats");
  const tTypes = useTranslations("bookings.resourceType");
  const format = useFormatter();
  const resources = Array.isArray(stats.resources) ? stats.resources : [];
  const { totals } = stats;
  const capacityHours = totals.openingHours * Math.max(1, resources.length);
  const average = capacityHours > 0 ? Math.min(1, totals.bookedHours / capacityHours) : 0;
  const busiest = resources[0];
  const anyUse = resources.some((resource) => resource.bookedHours > 0);
  const hours = (value: number) => format.number(value, { maximumFractionDigits: 1 });
  const summary =
    anyUse && busiest
      ? t("summary", { name: busiest.name, rate: format.number(busiest.occupancyRate, PERCENT), count: Math.min(CHART_LIMIT, resources.length) })
      : t("summaryNone");
  const navClass = cn(buttonVariants({ variant: "outline", size: "icon" }), "rounded-full");

  return (
    <section aria-labelledby="stats-title" className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="stats-title" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <nav aria-label={t("periodNav")} className="flex items-center gap-2">
          <Link href={previousHref} className={navClass} prefetch={false}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{t("previousMonth")}</span>
          </Link>
          <p className="min-w-36 text-center text-base font-semibold first-letter:uppercase" aria-live="polite">
            {periodLabel}
          </p>
          <Link href={nextHref} className={navClass} prefetch={false}>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{t("nextMonth")}</span>
          </Link>
        </nav>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        <StatTile label={t("requests")} value={format.number(totals.bookings)} />
        <StatTile label={t("bookedHours")} value={hours(totals.bookedHours)} hint={t("bookedHoursHint")} />
        <StatTile label={t("averageOccupancy")} value={format.number(average, PERCENT)} hint={t("averageOccupancyHint", { hours: hours(totals.openingHours) })} />
      </dl>

      <div className="rounded-3xl border bg-card p-4 text-card-foreground">
        <h3 className="text-sm font-semibold">{t("byStatus")}</h3>
        <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
          {BOOKING_STATUSES.map((status) => (
            <li key={status} className="flex items-center gap-2" data-status={status}>
              <BookingStatusBadge status={status} />
              <span className="text-lg font-semibold tabular-nums">{format.number(totals.byStatus?.[status] ?? 0)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-3 rounded-3xl border bg-card p-4 text-card-foreground sm:p-5">
        <h3 className="text-base font-semibold">{t("chartTitle")}</h3>
        {anyUse ? (
          <OccupancyChart resources={resources} summary={summary} />
        ) : (
          <EmptyState icon={ChartBar} headingLevel="p" title={t("summaryNone")} className="border-0 py-8" />
        )}
      </div>

      {resources.length > 0 && (
        <Table aria-label={t("tableCaption")}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("resource")}</TableHead>
              <TableHead>{t("type")}</TableHead>
              <TableHead className="text-right">{t("bookings")}</TableHead>
              <TableHead className="text-right">{t("hours")}</TableHead>
              <TableHead className="text-right">{t("occupancy")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {resources.map((resource) => (
              <TableRow key={`${resource.resourceType}-${resource.id}`}>
                <TableCell className="font-medium">{resource.name}</TableCell>
                <TableCell>{tTypes(resource.resourceType)}</TableCell>
                <TableCell className="text-right tabular-nums">{format.number(resource.bookings)}</TableCell>
                <TableCell className="text-right tabular-nums">{hours(resource.bookedHours)}</TableCell>
                <TableCell className="text-right tabular-nums">{format.number(resource.occupancyRate, PERCENT)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
