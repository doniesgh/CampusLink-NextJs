import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One key figure of a `<dl>` (label, value, optional hint and extra content). Values use proportional figures
 * (no tabular-nums at display size).
 */
export function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  children,
  className,
  valueProps,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  valueProps?: Record<`data-${string}`, string>;
}) {
  return (
    <div className={cn("min-w-0 rounded-3xl border bg-card p-4 text-card-foreground sm:p-5", className)}>
      <dt className="flex items-center gap-2 text-xs text-muted-foreground sm:text-sm">
        <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl" {...valueProps}>
        {value}
      </dd>
      {hint && <dd className="mt-1 text-xs text-muted-foreground sm:text-sm">{hint}</dd>}
      {children}
    </div>
  );
}
