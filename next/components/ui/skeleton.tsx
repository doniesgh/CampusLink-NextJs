import * as React from "react";
import { cn } from "@/lib/utils";

/** Loading placeholder (hidden from assistive tech: pair it with a visually hidden "Loading…" text). */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-xl bg-muted motion-reduce:animate-none", className)} {...props} />;
}

/** A few skeleton lines with an sr-only label, e.g. while useOfflineQuery has no data yet. */
export function SkeletonList({ rows = 3, label, className }: { rows?: number; label: string; className?: string }) {
  return (
    <div className={cn("space-y-3", className)} aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full rounded-2xl" />
      ))}
    </div>
  );
}
