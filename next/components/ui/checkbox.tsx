import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Native checkbox (works in forms/FormData, `getByLabel(...).check()` in tests).
 *   <label className="flex items-center gap-2"><Checkbox name="unread" /> Unread only</label>
 * or <CheckboxField label="Unread only" ... />.
 */
export const Checkbox = React.forwardRef<HTMLInputElement, Omit<React.ComponentProps<"input">, "type">>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        "h-4 w-4 shrink-0 cursor-pointer rounded border-input accent-primary",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Checkbox.displayName = "Checkbox";

export function CheckboxField({
  label,
  description,
  className,
  id,
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & { label: React.ReactNode; description?: React.ReactNode; id: string }) {
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <Checkbox id={id} aria-describedby={descriptionId} className="mt-0.5" {...props} />
      <div className="grid gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium leading-5">
          {label}
        </label>
        {description && (
          <p id={descriptionId} className="text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
