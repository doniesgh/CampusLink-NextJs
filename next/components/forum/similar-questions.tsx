"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { bffFetch, useOnlineStatus } from "@/lib/offline";
import { questionHref, similarPath } from "@/lib/forum/paths";
import type { SimilarQuestion } from "@/lib/forum/types";
import { normalizeTitle } from "@/lib/forum/validation";

/** Suggestions start after this many characters, once the user stops typing for DEBOUNCE_MS. */
const MIN_LENGTH = 8;
const DEBOUNCE_MS = 400;

/**
 * "Similar questions already asked" while the title is typed (GET /api/forum/questions/similar, online only).
 * The API answers [] for titles without a significant word. Links open in a new tab so the draft stays.
 */
export function SimilarQuestions({ title, excludeId }: { title: string; excludeId?: string }) {
  const t = useTranslations("forum.similar");
  const online = useOnlineStatus();
  const query = normalizeTitle(title);
  const active = online && query.length >= MIN_LENGTH;
  const [result, setResult] = useState<{ query: string; items: SimilarQuestion[] }>({ query: "", items: [] });

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      bffFetch<SimilarQuestion[]>(similarPath(query), { signal: controller.signal })
        .then((items) => setResult({ query, items: Array.isArray(items) ? items : [] }))
        .catch(() => undefined);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, query]);

  // The last answer stays on screen while the next one is on its way (no flicker while typing).
  const items = active ? result.items.filter((item) => item.id !== excludeId) : [];

  return (
    <div aria-live="polite">
      {items.length > 0 && (
        <section aria-labelledby="similar-questions-title" className="rounded-2xl border border-primary/20 bg-accent/60 p-4" data-testid="similar-questions">
          <h3 id="similar-questions-title" className="text-sm font-semibold text-foreground">
            {t("title")}
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("intro")}</p>
          <ul className="mt-3 space-y-2">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <a
                  href={questionHref(item.id)}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex min-w-0 items-baseline gap-1 rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="break-words">{item.title}</span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 self-center" aria-hidden="true" />
                  <span className="sr-only">{t("newTab")}</span>
                </a>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  {item.hasAcceptedAnswer ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                      <span className="font-semibold text-success">{t("solved")}</span>
                    </>
                  ) : (
                    <>
                      <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("answers", { count: item.answerCount })}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
