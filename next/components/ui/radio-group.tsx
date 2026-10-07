"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Native radio buttons in a fieldset (keyboard + forms + `getByLabel("This session only").check()`).
 *
 *   <RadioGroup legend="Apply to" name="scope" defaultValue="occurrence"
 *     options={[{ value: "occurrence", label: "This session only" }, { value: "series", label: "This and following sessions" }]} />
 */
export function RadioGroup({
  legend,
  name,
  options,
  value,
  defaultValue,
  onValueChange,
  className,
  legendClassName,
  disabled,
}: {
  legend: React.ReactNode;
  name: string;
  options: readonly { value: string; label: React.ReactNode; description?: React.ReactNode }[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  legendClassName?: string;
  disabled?: boolean;
}) {
  const baseId = React.useId();
  return (
    <fieldset className={cn("space-y-2", className)} disabled={disabled}>
      <legend className={cn("mb-2 text-sm font-medium", legendClassName)}>{legend}</legend>
      {options.map((option, index) => {
        const id = `${baseId}-${index}`;
        return (
          <div key={option.value} className="flex items-start gap-3">
            <input
              id={id}
              type="radio"
              name={name}
              value={option.value}
              {...(value !== undefined
                ? { checked: value === option.value, onChange: () => onValueChange?.(option.value) }
                : { defaultChecked: defaultValue === option.value, onChange: () => onValueChange?.(option.value) })}
              className="mt-0.5 h-4 w-4 cursor-pointer accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
            <label htmlFor={id} className="cursor-pointer text-sm leading-5">
              {option.label}
              {option.description && <span className="block text-muted-foreground">{option.description}</span>}
            </label>
          </div>
        );
      })}
    </fieldset>
  );
}
