"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type SelectOption = { value: string; label: string; group?: string };

/**
 * Native select whose value lives in the URL (`?<param>=value`): changing it replaces the URL and the server page
 * renders the new data. `query` = the current query (from the server page); `reset` lists parameters dropped on
 * change (e.g. "page"). Options with a `group` are rendered in <optgroup>s, in order of appearance.
 */
export function UrlSelect({
  id,
  label,
  param,
  value,
  options,
  allLabel,
  query,
  reset = ["page"],
  className,
}: {
  id: string;
  label: string;
  param: string;
  value: string;
  options: SelectOption[];
  /** Option for "no filter" (empty value); omitted when a value is required. */
  allLabel?: string;
  query: Record<string, string | undefined>;
  reset?: string[];
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const onChange = (next: string) => {
    const params = new URLSearchParams();
    for (const [key, current] of Object.entries(query)) if (current) params.set(key, current);
    for (const key of reset) params.delete(key);
    if (next) params.set(param, next);
    else params.delete(param);
    const search = params.toString();
    startTransition(() => router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false }));
  };

  const groups: { name: string | undefined; options: SelectOption[] }[] = [];
  for (const option of options) {
    const last = groups[groups.length - 1];
    if (last && last.name === option.group) last.options.push(option);
    else groups.push({ name: option.group, options: [option] });
  }
  const render = (option: SelectOption) => (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  );

  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <Select id={id} value={value} onChange={(event) => onChange(event.target.value)} aria-busy={pending || undefined}>
        {allLabel !== undefined && <option value="">{allLabel}</option>}
        {groups.map((group, index) =>
          group.name ? (
            <optgroup key={`${group.name}-${index}`} label={group.name}>
              {group.options.map(render)}
            </optgroup>
          ) : (
            group.options.map(render)
          )
        )}
      </Select>
    </div>
  );
}
