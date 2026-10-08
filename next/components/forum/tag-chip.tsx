"use client";

import { Hash } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "@/components/ui/app-link";
import { listHref } from "@/lib/forum/paths";
import { cn } from "@/lib/utils";

const CHIP =
  "relative z-10 inline-flex items-center gap-0.5 rounded-full border border-transparent bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * A question's tag: filters the list on the list page (`onSelect`, no navigation), or links to the list
 * filtered by that tag elsewhere. `active` marks the tag currently filtered on.
 */
export function TagChip({ tag, onSelect, active = false }: { tag: string; onSelect?: (tag: string) => void; active?: boolean }) {
  const t = useTranslations("forum.card");
  const content = (
    <>
      <Hash className="h-3 w-3" aria-hidden="true" />
      {tag}
    </>
  );
  if (onSelect) {
    return (
      <button
        type="button"
        className={cn(CHIP, active && "border-primary bg-primary text-primary-foreground")}
        aria-label={t("filterByTag", { tag })}
        aria-pressed={active}
        onClick={() => onSelect(tag)}
      >
        {content}
      </button>
    );
  }
  return (
    <Link href={listHref({ tag })} className={CHIP} aria-label={t("filterByTag", { tag })}>
      {content}
    </Link>
  );
}
