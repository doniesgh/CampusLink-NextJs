"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Select } from "@/components/ui/select";

/** "Action" filter of the audit log: updates ?action= (the server page reloads the list). */
export function ActionFilter({ value, actions }: { value: string; actions: readonly string[] }) {
  const t = useTranslations("admin.audit");
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const options = value && !actions.includes(value) ? [value, ...actions] : actions;

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
        {options.map((action) => (
          <option key={action} value={action}>
            {action}
          </option>
        ))}
      </Select>
    </div>
  );
}
