import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Styled NATIVE <select>: best on mobile, works without JS and in forms, and Playwright can use
 * `getByLabel("Subject").selectOption(...)`. Link it to a <Label htmlFor>.
 *
 *   <Label htmlFor="role">Role</Label>
 *   <Select id="role" name="role" defaultValue="STUDENT">
 *     <option value="STUDENT">Student</option>
 *   </Select>
 *
 * Use `multiple` for multi-selects (no chevron is drawn then).
 */
export const Select = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select"> & { wrapperClassName?: string }>(
  ({ className, wrapperClassName, multiple, children, ...props }, ref) => (
    <div className={cn("relative", wrapperClassName)}>
      <select
        ref={ref}
        multiple={multiple}
        className={cn(
          "flex w-full rounded-xl border border-input bg-background text-base text-foreground md:text-sm",
          multiple ? "min-h-28 px-2 py-2" : "h-10 appearance-none py-2 pl-3 pr-10",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive",
          className
        )}
        {...props}
      >
        {children}
      </select>
      {!multiple && (
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
      )}
    </div>
  )
);
Select.displayName = "Select";
