import { cn } from "@/lib/utils";

/**
 * Chart colour tokens of the analytics charts, light and dark (Tailwind's `dark:` = prefers-color-scheme, like the
 * design tokens in app/globals.css). Three categorical slots validated together for colour-vision deficiencies
 * (adjacent and all pairs) on the card surfaces #ffffff and #161e33; every chart also has a text summary and a
 * table, so nothing depends on colour alone. Axis, grid and text colours come from the app tokens
 * (--border, --muted-foreground, --card, --foreground).
 */
export const CHART_TOKENS =
  "[--chart-1:#2a78d6] [--chart-2:#eb6834] [--chart-3:#1baf7a] dark:[--chart-1:#3987e5] dark:[--chart-2:#d95926] dark:[--chart-3:#199e70]";

export const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 12 } as const;

/** Small colour key (decorative: its label is written next to it). */
export function Swatch({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]", className)} style={{ backgroundColor: color }} />;
}

/** Box of a chart tooltip (shown on hover only; the same values are in the table). */
export function TooltipBox({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-w-36 rounded-xl border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <p className="mb-1 font-semibold">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

/** "Show as a table" disclosure under a chart. */
export function ChartTable({
  summary,
  caption,
  head,
  rows,
}: {
  summary: string;
  caption: string;
  head: React.ReactNode[];
  rows: { key: string; cells: React.ReactNode[] }[];
}) {
  return (
    <details className="rounded-2xl border bg-background px-4 py-2 text-sm">
      <summary className="cursor-pointer rounded-lg font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {summary}
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              {head.map((cell, index) => (
                <th key={index} scope="col" className={cn("py-1.5 pr-3 font-semibold", index > 0 && "text-right")}>
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b last:border-0">
                {row.cells.map((cell, index) =>
                  index === 0 ? (
                    <th key={index} scope="row" className="py-1.5 pr-3 font-normal">
                      {cell}
                    </th>
                  ) : (
                    <td key={index} className="py-1.5 pr-3 text-right tabular-nums">
                      {cell}
                    </td>
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
