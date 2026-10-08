import { useTranslations } from "next-intl";
import Link from "@/components/ui/app-link";
import { profileHref } from "@/lib/forum/paths";
import type { ForumAuthor } from "@/lib/forum/types";
import { cn } from "@/lib/utils";

/** "Amira Ben Salah", or "Former member" when the account is unknown. */
export function useForumAuthorName(): (author: ForumAuthor | undefined) => string {
  const t = useTranslations("forum");
  return (author) => {
    const name = author ? `${author.firstname ?? ""} ${author.lastname ?? ""}`.trim() : "";
    return name || t("unknownAuthor");
  };
}

/**
 * The author's name linking to their forum profile, with the role ("Teacher") after it.
 * `relative z-10` keeps it clickable above a card's full-size title link.
 */
export function AuthorLink({ author, className, showRole = true }: { author: ForumAuthor | undefined; className?: string; showRole?: boolean }) {
  const tRoles = useTranslations("common.roles");
  const name = useForumAuthorName()(author);
  const role = author?.role ? tRoles(author.role) : null;
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-1", className)}>
      {author?.id ? (
        <Link
          href={profileHref(author.id)}
          className="relative z-10 rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {name}
        </Link>
      ) : (
        <span className="font-medium text-foreground">{name}</span>
      )}
      {showRole && role && <span className="text-muted-foreground">({role})</span>}
    </span>
  );
}
