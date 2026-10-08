"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CloudOff, MessageCircleQuestion, MessagesSquare, Plus, RotateCw, Search, SearchX, UserRound, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { LeaderboardCard } from "@/components/forum/leaderboard-card";
import { QuestionCard } from "@/components/forum/question-card";
import { QuestionForm } from "@/components/forum/question-form";
import Link from "@/components/ui/app-link";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback, type Feedback } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { SkeletonList } from "@/components/ui/skeleton";
import { isPageSaved, openPageFully } from "@/lib/announcements/offline";
import { useErrorFormatter } from "@/lib/i18n/client";
import { invalidateQueries, useOfflineQuery, useOnlineStatus } from "@/lib/offline";
import {
  EMPTY_FILTERS,
  effectiveSort,
  isFiltered,
  matchesLocally,
  normalizeFilters,
  parseFilters,
  sortLocally,
  type ForumFilters,
  type ForumSort,
} from "@/lib/forum/filters";
import {
  DEFAULT_LIST_KEY,
  FORUM_PAGE_SIZE,
  listHref,
  listKey,
  profileHref,
  questionHref,
  questionsPath,
} from "@/lib/forum/paths";
import { useForumSubjects, useForumTags, type Snapshot } from "@/lib/forum/queries";
import { LEVELS, type Leaderboard, type Question, type QuestionList, type TagCount } from "@/lib/forum/types";
import type { Subject } from "@/lib/types";
import { createQuestionAction } from "./actions";

type LinkClick = (event: React.MouseEvent<HTMLAnchorElement>, question: Question) => void;

export type ForumInitial = {
  list: Snapshot<QuestionList>;
  subjects: Snapshot<Subject[]>;
  tags: Snapshot<TagCount[]>;
  leaderboard: Snapshot<Leaderboard>;
};

/** Sorts offered by the "Sort by" select ("Best match" only with a search). */
function sortOptions(filters: ForumFilters): ForumSort[] {
  if (filters.sort === "unanswered") return ["unanswered"];
  return filters.q ? ["relevance", "recent", "votes", "activity"] : ["recent", "votes", "activity"];
}

/** Pages 2..n of the list ("Load more"), each its own offline query. */
function NextListPage({ filters, page, onTagSelect, onLinkClick }: { filters: ForumFilters; page: number; onTagSelect: (tag: string) => void; onLinkClick: LinkClick }) {
  const t = useTranslations("forum.list");
  const tStates = useTranslations("common.states");
  const { data, isLoading } = useOfflineQuery<QuestionList>(listKey(filters, page), questionsPath(filters, page));
  if (isLoading) {
    return (
      <li>
        <SkeletonList rows={2} label={tStates("loading")} />
      </li>
    );
  }
  if (!data || !Array.isArray(data.items)) return <li className="px-1 text-sm text-muted-foreground">{t("pageError")}</li>;
  return (
    <>
      {data.items.map((question) => (
        <li key={question.id}>
          <QuestionCard question={question} activeTag={filters.tag} onTagSelect={onTagSelect} onLinkClick={onLinkClick} />
        </li>
      ))}
    </>
  );
}

/** The questions for the current filters: first page from the server, "Load more", offline fallbacks. */
function QuestionResults({
  filters,
  initial,
  onTagSelect,
  onLinkClick,
  onReset,
}: {
  filters: ForumFilters;
  initial: Snapshot<QuestionList>;
  onTagSelect: (tag: string) => void;
  onLinkClick: LinkClick;
  onReset: () => void;
}) {
  const t = useTranslations("forum.list");
  const tStates = useTranslations("common.states");
  const tActions = useTranslations("common.actions");
  const errors = useErrorFormatter();
  const online = useOnlineStatus();
  const [pages, setPages] = useState(1);

  const first = useOfflineQuery<QuestionList>(listKey(filters, 1), questionsPath(filters, 1), {
    fallbackData: initial?.data ?? undefined,
    fallbackSavedAt: initial?.savedAt,
    revalidateOnMount: !initial?.data,
  });
  // Offline, a filter combination never loaded on this device: filter the saved default list instead.
  const offline = !online || !!first.error?.isNetworkError || first.error?.code === "OFFLINE";
  const fallBack = isFiltered(filters) && !first.data && !first.isLoading && offline;
  const saved = useOfflineQuery<QuestionList>(DEFAULT_LIST_KEY, fallBack ? questionsPath(EMPTY_FILTERS, 1) : null, {
    revalidateOnMount: false,
  });

  if (first.isLoading || (fallBack && saved.isLoading)) return <SkeletonList rows={4} label={tStates("loading")} />;

  const list = first.data ?? (fallBack ? saved.data : undefined);
  if (!list || !Array.isArray(list.items)) {
    if (offline) return <EmptyState icon={CloudOff} title={t("notSavedTitle")} description={t("notSavedText")} />;
    return (
      <InlineFeedback feedback={{ type: "error", message: first.error ? `${t("loadError")} ${errors.message(first.error)}` : t("loadError") }}>
        <Button variant="outline" size="sm" className="mt-2 rounded-full" onClick={() => void first.refresh()}>
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          {tActions("tryAgain")}
        </Button>
      </InlineFeedback>
    );
  }

  const usingFallback = !first.data;
  const items = usingFallback ? sortLocally(list.items.filter((question) => matchesLocally(question, filters)), filters) : list.items;
  const total = usingFallback ? items.length : (list.total ?? items.length);

  if (items.length === 0) {
    return isFiltered(filters) ? (
      <EmptyState
        icon={SearchX}
        title={t("noResults")}
        description={usingFallback ? t("offlineFiltered") : t("noResultsText")}
        action={
          <Button variant="outline" className="rounded-full" onClick={onReset}>
            <X className="h-4 w-4" aria-hidden="true" />
            {tActions("resetFilters")}
          </Button>
        }
      />
    ) : (
      <EmptyState icon={MessagesSquare} title={t("empty")} description={t("emptyText")} />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground" data-testid="forum-count">
        {t("count", { count: total })}
      </p>
      {usingFallback && <p className="rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground">{t("offlineFiltered")}</p>}
      <ul className="space-y-3">
        {items.map((question) => (
          <li key={question.id}>
            <QuestionCard question={question} activeTag={filters.tag} onTagSelect={onTagSelect} onLinkClick={onLinkClick} />
          </li>
        ))}
        {!usingFallback &&
          Array.from({ length: pages - 1 }, (_, index) => (
            <NextListPage key={index + 2} filters={filters} page={index + 2} onTagSelect={onTagSelect} onLinkClick={onLinkClick} />
          ))}
      </ul>
      {!usingFallback && total > pages * FORUM_PAGE_SIZE && (
        <div className="flex justify-center">
          <Button variant="outline" className="rounded-full" onClick={() => setPages((count) => count + 1)}>
            {tActions("loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * /dashboard/forum: search, "Subject" / "Level" / "Tag" filters, "Sort by", "Unanswered only", the questions,
 * "Ask a question" (with similar questions while typing the title) and the top helpers of the year.
 * Filters live in the URL (replaced without a server round trip). Readable offline from IndexedDB.
 */
export function ForumView({
  filters: initialFilters,
  initial,
  viewerId,
  openAsk,
  done,
}: {
  filters: ForumFilters;
  initial: ForumInitial;
  viewerId: string;
  openAsk: boolean;
  done: "deleted" | null;
}) {
  const t = useTranslations("forum");
  const tList = useTranslations("forum.list");
  const tAsk = useTranslations("forum.ask");
  const tActions = useTranslations("common.actions");
  const errors = useErrorFormatter();
  const router = useRouter();
  const online = useOnlineStatus();
  // The address may hold other filters than the server rendered (back navigation to a replaced history entry).
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<ForumFilters>(() => parseFilters(searchParams));
  const [searchText, setSearchText] = useState(filters.q);
  const [askOpen, setAskOpen] = useState(openAsk);
  const [feedback, setFeedback] = useState<Feedback | null>(done === "deleted" ? { type: "success", message: tList("deleted") } : null);
  const subjects = useForumSubjects(initial.subjects);
  const tags = useForumTags(filters.subject, filters.subject === initialFilters.subject ? initial.tags : undefined);

  // "?done=deleted" / "?ask=1" are one-time: keep only the filters in the address.
  useEffect(() => {
    if (!done && !openAsk) return;
    window.history.replaceState(window.history.state, "", listHref(initialFilters));
  }, [done, openAsk, initialFilters]);

  const apply = (next: ForumFilters) => {
    const normalized = normalizeFilters(next);
    setFilters(normalized);
    setSearchText(normalized.q);
    window.history.replaceState(window.history.state, "", listHref(normalized));
  };
  const reset = () => apply(EMPTY_FILTERS);
  const selectTag = (tag: string) => apply({ ...filters, tag: filters.tag === tag ? "" : tag });

  const onLinkClick: LinkClick = (event, question) => {
    if (online) return;
    // Offline: a full page load is answered by the service worker with the saved page, if there is one.
    event.preventDefault();
    const href = questionHref(question.id);
    void isPageSaved(href).then((saved) => {
      if (saved) openPageFully(href);
      else setFeedback({ type: "info", message: tList("questionNotSaved"), at: Date.now() });
    });
  };

  const toggleAsk = () => {
    const next = !askOpen;
    setAskOpen(next);
    if (next) requestAnimationFrame(() => document.getElementById("ask-title")?.focus());
  };

  const resultsKey = listKey(filters, 1).join("|");
  const initialResultsKey = listKey(initialFilters, 1).join("|");
  const tagOptions = filters.tag && !tags.some((entry) => entry.tag === filters.tag) ? [{ tag: filters.tag, count: 0 }, ...tags] : tags;
  const unanswered = filters.sort === "unanswered";

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Button asChild variant="outline" className="rounded-full">
              <Link href={profileHref(viewerId)}>
                <UserRound className="h-4 w-4" aria-hidden="true" />
                {tList("myProfile")}
              </Link>
            </Button>
            <Button type="button" className="rounded-full" aria-expanded={askOpen} aria-controls="ask-question-panel" onClick={toggleAsk}>
              {askOpen ? <X className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
              {tList("askQuestion")}
            </Button>
          </>
        }
      />

      {askOpen && (
        <section id="ask-question-panel" aria-labelledby="ask-question-title" className="rounded-3xl border bg-card p-5 text-card-foreground sm:p-6">
          <h2 id="ask-question-title" className="flex items-center gap-2 text-lg font-semibold">
            <MessageCircleQuestion className="h-5 w-5 text-primary" aria-hidden="true" />
            {tAsk("title")}
          </h2>
          <p className="mb-5 mt-1 text-sm text-muted-foreground">{tAsk("intro")}</p>
          <QuestionForm
            idPrefix="ask"
            mode="ask"
            subjects={subjects}
            initialValues={{ title: "", body: "", subject: filters.subject, chapter: "", level: filters.level, tags: filters.tag }}
            onCancel={() => setAskOpen(false)}
            onFailure={(message) => setFeedback({ type: "error", message, at: Date.now() })}
            submit={async (input) => {
              try {
                const result = await createQuestionAction(input);
                if (result.ok && result.data?.id) {
                  invalidateQueries("forum");
                  router.push(questionHref(result.data.id));
                }
                return result;
              } catch {
                return { ok: false, message: errors.forCode("NETWORK_ERROR") };
              }
            }}
          />
        </section>
      )}

      <section aria-labelledby="forum-filters-title" className="space-y-4 rounded-3xl border bg-card p-4 text-card-foreground sm:p-5">
        <h2 id="forum-filters-title" className="sr-only">
          {tList("filtersTitle")}
        </h2>
        <form
          role="search"
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            apply({ ...filters, q: searchText });
          }}
        >
          <label htmlFor="forum-search" className="sr-only">
            {tList("search")}
          </label>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="forum-search"
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder={tList("searchPlaceholder")}
              maxLength={200}
              className="pl-9"
            />
          </div>
          <Button type="submit" className="shrink-0">
            {tList("searchButton")}
          </Button>
        </form>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Field id="forum-subject" label={tList("subject")}>
            {(props) => (
              <Select {...props} value={filters.subject} onChange={(event) => apply({ ...filters, subject: event.target.value })}>
                <option value="">{tList("allSubjects")}</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="forum-level" label={tList("level")}>
            {(props) => (
              <Select {...props} value={filters.level} onChange={(event) => apply({ ...filters, level: event.target.value })}>
                <option value="">{tList("allLevels")}</option>
                {LEVELS.map((level) => (
                  <option key={level} value={String(level)}>
                    {t("levelValue", { level })}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="forum-tag" label={tList("tag")}>
            {(props) => (
              <Select {...props} value={filters.tag} onChange={(event) => apply({ ...filters, tag: event.target.value })}>
                <option value="">{tList("allTags")}</option>
                {tagOptions.map((entry) => (
                  <option key={entry.tag} value={entry.tag}>
                    {entry.count > 0 ? tList("tagOption", { tag: entry.tag, count: entry.count }) : entry.tag}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="forum-sort" label={tList("sort")}>
            {(props) => (
              <Select
                {...props}
                value={effectiveSort(filters)}
                disabled={unanswered}
                onChange={(event) => apply({ ...filters, sort: event.target.value as ForumSort })}
              >
                {sortOptions(filters).map((sort) => (
                  <option key={sort} value={sort}>
                    {tList(`sorts.${sort}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <CheckboxField
            id="forum-unanswered"
            label={tList("unansweredOnly")}
            checked={unanswered}
            onChange={(event) => apply({ ...filters, sort: event.target.checked ? "unanswered" : "" })}
          />
          {isFiltered(filters) && (
            <Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={reset}>
              <X className="h-4 w-4" aria-hidden="true" />
              {tActions("resetFilters")}
            </Button>
          )}
        </div>
      </section>

      <InlineFeedback feedback={feedback} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <section aria-labelledby="forum-questions-title" className="min-w-0 space-y-3">
          <h2 id="forum-questions-title" className="sr-only">
            {tList("questionsHeading")}
          </h2>
          <QuestionResults
            key={resultsKey}
            filters={filters}
            // The server rendered the first page of the filters of the address only.
            initial={resultsKey === initialResultsKey ? initial.list : null}
            onTagSelect={selectTag}
            onLinkClick={onLinkClick}
            onReset={reset}
          />
        </section>
        <aside className="lg:sticky lg:top-6">
          <LeaderboardCard initial={initial.leaderboard} viewerId={viewerId} />
        </aside>
      </div>
    </div>
  );
}
