"use client";

import { Download, GraduationCap } from "lucide-react";
import { useTranslations } from "next-intl";
import { OwnershipBadge, PriceBadge, StatusBadge, SubjectBadge, TypeBadge } from "@/components/marketplace/badges";
import { RatingStars } from "@/components/marketplace/rating-stars";
import { useDateLabel, usePersonName } from "@/components/marketplace/use-market-format";
import Link from "@/components/ui/app-link";
import { Badge } from "@/components/ui/badge";
import { documentHref } from "@/lib/marketplace/paths";
import type { MarketDocument } from "@/lib/marketplace/types";
import { cn } from "@/lib/utils";

/** First lines of the description on one paragraph (the card shows 2 lines at most). */
const excerptOf = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 240);

/**
 * One document: an <article> whose title links to the document page (the whole card is clickable), with the type,
 * the price ("Free" / "12 tokens"), subject, level, professor, an excerpt, the rating, the downloads and the author.
 * `children` (actions, rejection reason...) are drawn above the card link.
 */
export function DocumentCard({
  document,
  headingLevel = "h3",
  showStatus = false,
  showOwnership = true,
  highlighted = false,
  children,
}: {
  document: MarketDocument;
  headingLevel?: "h2" | "h3";
  /** Status pill even for a published document ("My documents"). */
  showStatus?: boolean;
  /** "Your document" / "In your library" (off in "My documents", where every card is one of those). */
  showOwnership?: boolean;
  highlighted?: boolean;
  children?: React.ReactNode;
}) {
  const t = useTranslations("marketplace.card");
  const tMarket = useTranslations("marketplace");
  const dateLabel = useDateLabel();
  const personName = usePersonName();
  const Heading = headingLevel;
  const date = document.publishedAt ?? document.createdAt;

  return (
    <article
      className={cn(
        "group relative flex h-full flex-col rounded-2xl border bg-card p-4 text-card-foreground transition-colors hover:bg-accent/50 focus-within:ring-2 focus-within:ring-ring sm:p-5",
        highlighted && "ring-2 ring-highlight"
      )}
      data-document-id={document.id}
      data-status={document.status}
      data-price-kind={document.price === 0 ? "free" : "premium"}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TypeBadge type={document.type} />
        <PriceBadge price={document.price} />
      </div>
      <Heading className="mt-3 break-words text-base font-semibold leading-snug text-foreground">
        <Link
          href={documentHref(document.id)}
          className="rounded-sm after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none"
        >
          {document.title}
        </Link>
      </Heading>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <SubjectBadge subject={document.subject} />
        {document.level !== null && <Badge variant="outline">{tMarket("levelValue", { level: document.level })}</Badge>}
        {(showStatus || document.status !== "PUBLISHED") && <StatusBadge status={document.status} />}
        {showOwnership && <OwnershipBadge mine={document.mine} purchased={document.purchased} />}
      </div>
      {document.professor && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <GraduationCap className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{tMarket("professorValue", { name: document.professor })}</span>
        </p>
      )}
      {document.description && <p className="mt-2 line-clamp-2 break-words text-sm text-muted-foreground">{excerptOf(document.description)}</p>}
      <div className="mt-auto pt-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-3">
          <RatingStars rating={document.rating} count={document.ratingCount} />
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            {t("downloads", { count: document.downloads })}
          </span>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t("sharedBy", { name: personName(document.author) })}
          <span aria-hidden="true"> · </span>
          <time dateTime={date}>{dateLabel(date)}</time>
        </p>
      </div>
      {children && <div className="relative z-10 mt-3 space-y-3">{children}</div>}
    </article>
  );
}
