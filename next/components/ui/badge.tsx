import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Pill badge (rounded-full) for statuses, priorities, roles and counters.
 * Every variant keeps a 4.5:1 text contrast in light and dark mode.
 *
 *   <Badge variant="danger">Urgent</Badge>   <Badge variant="highlight">New</Badge>
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-5",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-accent text-accent-foreground",
        neutral: "border-transparent bg-muted text-muted-foreground",
        highlight: "border-transparent bg-highlight text-highlight-foreground",
        success: "border-success/30 bg-success/10 text-success",
        warning: "border-highlight/50 bg-highlight/15 text-foreground",
        danger: "border-destructive/30 bg-destructive/10 text-destructive",
        outline: "border-border bg-transparent text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
