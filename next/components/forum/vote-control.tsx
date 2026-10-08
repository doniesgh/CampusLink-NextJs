"use client";

import { useState } from "react";
import { ArrowBigDown, ArrowBigUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { VoteValue } from "@/lib/forum/types";

const BUTTON =
  "inline-flex h-9 w-9 items-center justify-center rounded-full border border-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

/**
 * "Upvote" / score / "Downvote" (toggle buttons, aria-pressed). Voting again with the same value removes the
 * vote (API rule). Disabled on one's own post (`ownContent`), on hidden content and offline (`disabled`).
 */
export function VoteControl({
  kind,
  score,
  myVote,
  ownContent = false,
  disabled = false,
  onVote,
  className,
}: {
  kind: "question" | "answer";
  score: number;
  myVote: VoteValue;
  ownContent?: boolean;
  disabled?: boolean;
  /** Sends the vote; resolves when done (the parent updates score / myVote). */
  onVote: (value: 1 | -1) => Promise<void>;
  className?: string;
}) {
  const t = useTranslations("forum.vote");
  const [pending, setPending] = useState(false);
  // Not disabled while a vote is being sent: the focused button keeps the focus (extra clicks are ignored).
  const off = disabled || ownContent;

  const vote = async (value: 1 | -1) => {
    if (pending) return;
    setPending(true);
    try {
      await onVote(value);
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      role="group"
      aria-label={t(kind === "question" ? "questionGroup" : "answerGroup")}
      className={cn("inline-flex items-center gap-0.5 rounded-full border bg-background p-0.5", className)}
      title={ownContent ? t("own") : undefined}
      aria-busy={pending || undefined}
    >
      <button
        type="button"
        className={cn(BUTTON, myVote === 1 && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground")}
        aria-label={t("up")}
        aria-pressed={myVote === 1}
        disabled={off}
        onClick={() => void vote(1)}
      >
        <ArrowBigUp className="h-5 w-5" aria-hidden="true" />
      </button>
      <span className="min-w-[4.5rem] px-1 text-center text-sm font-semibold tabular-nums text-foreground" data-testid="vote-score" data-score={score}>
        {t("score", { count: score })}
      </span>
      <button
        type="button"
        className={cn(BUTTON, myVote === -1 && "bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:text-destructive-foreground")}
        aria-label={t("down")}
        aria-pressed={myVote === -1}
        disabled={off}
        onClick={() => void vote(-1)}
      >
        <ArrowBigDown className="h-5 w-5" aria-hidden="true" />
      </button>
      {ownContent && <span className="sr-only">{t("own")}</span>}
    </div>
  );
}
