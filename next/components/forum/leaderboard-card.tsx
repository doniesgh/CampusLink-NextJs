"use client";

import { Award, Trophy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useForumAuthorName } from "@/components/forum/author-link";
import Link from "@/components/ui/app-link";
import { profileHref } from "@/lib/forum/paths";
import { useLeaderboard, type Snapshot } from "@/lib/forum/queries";
import type { Leaderboard } from "@/lib/forum/types";
import { cn } from "@/lib/utils";

/** "Top helpers this year": reputation earned during the current academic year (GET /api/forum/leaderboard). */
export function LeaderboardCard({ initial, viewerId }: { initial: Snapshot<Leaderboard>; viewerId: string }) {
  const t = useTranslations("forum.list.leaderboard");
  const authorName = useForumAuthorName();
  const { data } = useLeaderboard(initial);
  const items = Array.isArray(data?.items) ? data.items : [];

  return (
    <section aria-labelledby="forum-leaderboard-title" className="rounded-3xl border bg-card p-5 text-card-foreground">
      <h2 id="forum-leaderboard-title" className="flex items-center gap-2 text-base font-semibold">
        <Trophy className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        {t("title")}
      </h2>
      {data?.academicYear && <p className="mt-0.5 pl-6 text-xs text-muted-foreground">{data.academicYear}</p>}
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ol className="mt-3 space-y-1">
          {items.map((entry) => (
            <li key={entry.user.id}>
              <Link
                href={profileHref(entry.user.id)}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-2 py-1.5 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  entry.user.id === viewerId && "bg-accent/60"
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground",
                    entry.rank === 1 && "bg-highlight text-highlight-foreground"
                  )}
                >
                  <span className="sr-only">{t("rank", { rank: entry.rank })}</span>
                  <span aria-hidden="true">{entry.rank}</span>
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{authorName(entry.user)}</span>
                {entry.badges > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground" aria-hidden="true">
                    <Award className="h-3.5 w-3.5" />
                    {entry.badges}
                  </span>
                )}
                <span className="shrink-0 text-xs font-semibold tabular-nums text-primary">{t("points", { count: entry.reputation })}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
