import Link from "@/components/ui/app-link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Previous / Next links for server-rendered paginated lists ({ items, total, page, limit }).
 * Keeps the other query parameters (filters). Server Component.
 *
 *   <Pagination pathname="/dashboard/admin/users" searchParams={{ q, role }} page={page} limit={limit} total={total} />
 */
export async function Pagination({
  pathname,
  searchParams,
  page,
  limit,
  total,
}: {
  pathname: string;
  searchParams: Record<string, string | undefined>;
  page: number;
  limit: number;
  total: number;
}) {
  const t = await getTranslations("common");
  const pages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  if (pages <= 1) return null;

  const href = (target: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) if (value) params.set(key, value);
    if (target > 1) params.set("page", String(target));
    else params.delete("page");
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  };

  const linkClass = cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-full");
  const disabledClass = cn(linkClass, "pointer-events-none opacity-50");

  return (
    <nav aria-label={t("pagination.label")} className="flex items-center justify-between gap-3">
      {page > 1 ? (
        <Link href={href(page - 1)} className={linkClass} rel="prev">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          {t("actions.previous")}
        </Link>
      ) : (
        <span className={disabledClass} aria-disabled="true">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          {t("actions.previous")}
        </span>
      )}
      <p className="text-sm text-muted-foreground">{t("pagination.pageOf", { page, pages })}</p>
      {page < pages ? (
        <Link href={href(page + 1)} className={linkClass} rel="next">
          {t("actions.next")}
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      ) : (
        <span className={disabledClass} aria-disabled="true">
          {t("actions.next")}
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </span>
      )}
    </nav>
  );
}
