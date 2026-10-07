import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Friendly empty / "coming soon" / error placeholder.
 *   <EmptyState icon={CalendarX} title="No classes in this period." description="…" action={<Button>…</Button>} />
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  headingLevel = "h2",
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  headingLevel?: "h2" | "h3" | "p";
}) {
  const Heading = headingLevel;
  return (
    <div className={cn("flex flex-col items-center rounded-3xl border border-dashed bg-card px-6 py-12 text-center", className)}>
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-primary">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <Heading className="mt-4 font-heading text-base font-semibold text-foreground">{title}</Heading>
      {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
