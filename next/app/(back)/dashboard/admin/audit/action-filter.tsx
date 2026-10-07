"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Select } from "@/components/ui/select";

export type ActionOption = { value: string; label: string };

/**
 * "Action" filter of the audit log: updates ?action= (the server page reloads the list).
 * Options show the readable label of each action code (the code itself when unknown); values are the codes.
 */
export function ActionFilter({ value, options: known }: { value: string; options: readonly ActionOption[] }) {
  const t = useTranslations("admin.audit");
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const options = value && !known.some((option) => option.value === value) ? [{ value, label: value }, ...known] : known;

  return (
    <div className="space-y-2 sm:w-80">
      <label htmlFor="audit-action" className="block text-sm font-medium">
        {t("action")}
      </label>
      <Select
        id="audit-action"
        value={value}
        aria-busy={pending || undefined}
        onChange={(event) => {
          const next = event.target.value;
          startTransition(() => router.replace(next ? `${pathname}?action=${encodeURIComponent(next)}` : pathname));
        }}
      >
        <option value="">{t("allActions")}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
