"use client";

import { useId, useOptimistic, useTransition } from "react";
import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { setLocaleAction } from "@/app/actions/locale";
import { Select } from "@/components/ui/select";
import { LOCALES } from "@/i18n/config";
import { cn } from "@/lib/utils";

/**
 * Language switcher: a native select labelled "Language" / "Langue" with "English" / "Français".
 * Changing it sets the NEXT_LOCALE cookie (Server Action), which re-renders the page in the new
 * language; signed-in users also get it saved on their account.
 */
export function LanguageSwitcher({
  hideLabel = false,
  className,
  selectClassName,
  onChanged,
}: {
  /** Visually hide the label (an icon is shown instead); it stays the select's accessible name. */
  hideLabel?: boolean;
  className?: string;
  selectClassName?: string;
  onChanged?: (locale: string) => void;
}) {
  const t = useTranslations("common.language");
  const locale = useLocale();
  const id = useId();
  const [optimisticLocale, setOptimisticLocale] = useOptimistic<string>(locale);
  const [pending, startTransition] = useTransition();

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <label htmlFor={id} className={cn("text-sm font-medium", hideLabel && "sr-only")}>
        {t("label")}
      </label>
      {hideLabel && <Languages className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
      <Select
        id={id}
        value={optimisticLocale}
        aria-busy={pending || undefined}
        onChange={(event) => {
          const next = event.target.value;
          startTransition(async () => {
            setOptimisticLocale(next);
            await setLocaleAction(next);
            onChanged?.(next);
          });
        }}
        className={cn("h-9 rounded-full py-1 pl-3 pr-9", selectClassName)}
      >
        {LOCALES.map((value) => (
          <option key={value} value={value} lang={value}>
            {t(value)}
          </option>
        ))}
      </Select>
    </div>
  );
}
