"use client";

import { useState } from "react";
import { CloudOff, Newspaper, PenLine, RotateCw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { PostCard, type AlumniViewer } from "@/components/alumni/post-card";
import { PostComposer } from "@/components/alumni/post-composer";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback, type Feedback } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { SkeletonList } from "@/components/ui/skeleton";
import { useErrorFormatter } from "@/lib/i18n/client";
import { invalidateQueries, useOfflineQuery, useOnlineStatus, useQueryClient } from "@/lib/offline";
import type { Snapshot } from "@/lib/alumni/client";
import { EMPTY_POST_FILTERS, POSTS_PAGE_SIZE, postsKey, postsPath, type PostFilters } from "@/lib/alumni/paths";
import { isList, POST_TYPES, type AlumniPost, type PostList, type PostType } from "@/lib/alumni/types";

type CardEvents = { viewer: AlumniViewer; report: (feedback: Feedback) => void };

/** Removes / replaces a post in a saved page. */
const without = (post: AlumniPost) => (current: PostList | undefined) =>
  current && Array.isArray(current.items)
    ? { ...current, items: current.items.filter((item) => item.id !== post.id), total: Math.max(0, (current.total ?? 1) - 1) }
    : current;
const replaced = (post: AlumniPost) => (current: PostList | undefined) =>
  current && Array.isArray(current.items) ? { ...current, items: current.items.map((item) => (item.id === post.id ? post : item)) } : current;

/** Pages 2..n ("Load more"), each its own offline query. */
function NextPage({ filters, page, viewer, report }: { filters: PostFilters; page: number } & CardEvents) {
  const t = useTranslations("alumni.news");
  const tStates = useTranslations("common.states");
  const { data, isLoading, mutate } = useOfflineQuery<PostList>(postsKey(filters, page), postsPath(filters, page));
  if (isLoading) {
    return (
      <li>
        <SkeletonList rows={2} label={tStates("loading")} />
      </li>
    );
  }
  if (!isList<AlumniPost>(data)) return <li className="px-1 text-sm text-muted-foreground">{t("pageError")}</li>;
  return (
    <>
      {data.items.map((post) => (
        <li key={post.id}>
          <PostCard post={post} viewer={viewer} report={report} onRemoved={(item) => mutate(without(item))} onChanged={(item) => mutate(replaced(item))} />
        </li>
      ))}
    </>
  );
}

function Results({
  filters,
  initial,
  viewer,
  report,
  emptyTitle,
  emptyText,
}: { filters: PostFilters; initial: Snapshot<PostList>; emptyTitle: string; emptyText: string } & CardEvents) {
  const t = useTranslations("alumni.news");
  const tStates = useTranslations("common.states");
  const tActions = useTranslations("common.actions");
  const errors = useErrorFormatter();
  const online = useOnlineStatus();
  const [pages, setPages] = useState(1);
  const first = useOfflineQuery<PostList>(postsKey(filters, 1), postsPath(filters, 1), {
    fallbackData: initial?.data ?? undefined,
    fallbackSavedAt: initial?.savedAt,
    revalidateOnMount: !initial?.data,
  });

  if (first.isLoading) return <SkeletonList rows={3} label={tStates("loading")} />;
  const list = first.data;
  if (!isList<AlumniPost>(list)) {
    const offline = !online || !!first.error?.isNetworkError || first.error?.code === "OFFLINE";
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
  if (list.items.length === 0) return <EmptyState icon={Newspaper} title={emptyTitle} description={emptyText} headingLevel="h3" />;

  const total = typeof list.total === "number" ? list.total : list.items.length;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground" data-testid="posts-count">
        {t("count", { count: total })}
      </p>
      <ul className="space-y-3">
        {list.items.map((post) => (
          <li key={post.id}>
            <PostCard
              post={post}
              viewer={viewer}
              report={report}
              onRemoved={(item) => first.mutate(without(item))}
              onChanged={(item) => first.mutate(replaced(item))}
            />
          </li>
        ))}
        {Array.from({ length: pages - 1 }, (_, index) => (
          <NextPage key={index + 2} filters={filters} page={index + 2} viewer={viewer} report={report} />
        ))}
      </ul>
      {total > pages * POSTS_PAGE_SIZE && (
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
 * News wall of the alumni (`mode="wall"`, every role) or "My posts" of an alumni (`mode="mine"`, `author=me`, hidden
 * ones included): "Share news" for ALUMNI, filter "Type" (and "Show" for ADMIN: visible / hidden posts), pages of 10
 * with "Load more". Posts are plain text. One feedback region for the whole wall.
 */
export function NewsWall({
  mode,
  viewer,
  initial,
  headingId,
}: {
  mode: "wall" | "mine";
  viewer: AlumniViewer;
  initial: Snapshot<PostList>;
  headingId: string;
}) {
  const t = useTranslations("alumni.news");
  const tTypes = useTranslations("alumni.postTypes");
  const tActions = useTranslations("common.actions");
  const queryClient = useQueryClient();
  const baseFilters: PostFilters = { ...EMPTY_POST_FILTERS, author: mode === "mine" ? "me" : "" };
  const [filters, setFilters] = useState<PostFilters>(baseFilters);
  const [composerOpen, setComposerOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const report = (value: Feedback) => setFeedback({ ...value, at: Date.now() });
  const canPost = viewer.role === "ALUMNI";
  const isAdmin = viewer.role === "ADMIN";
  const filtered = !!(filters.type || filters.hidden);
  const key = postsKey(filters, 1).join("|");
  const initialKey = postsKey(baseFilters, 1).join("|");
  const panelId = `${headingId}-composer`;

  const published = (post: AlumniPost, message: string) => {
    setComposerOpen(false);
    report({ type: "success", message: message || t("published") });
    // Show it at once at the top of the list being read, then refresh every loaded list.
    if (!filters.type || filters.type === post.type) {
      queryClient.setQueryData<PostList>(postsKey(filters, 1), (current) =>
        current && Array.isArray(current.items) && !current.items.some((item) => item.id === post.id)
          ? { ...current, items: [post, ...current.items], total: (current.total ?? 0) + 1 }
          : current
      );
    }
    invalidateQueries("alumni:posts");
  };

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id={headingId} className="text-lg font-semibold text-foreground">
            {t(mode === "mine" ? "mineTitle" : "title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t(mode === "mine" ? "mineIntro" : canPost ? "introAlumni" : "intro")}</p>
        </div>
        {canPost && (
          <Button
            type="button"
            className="shrink-0 rounded-full"
            aria-expanded={composerOpen}
            aria-controls={panelId}
            onClick={() => {
              const next = !composerOpen;
              setComposerOpen(next);
              if (next) requestAnimationFrame(() => document.getElementById(`${panelId}-type`)?.focus());
            }}
          >
            {composerOpen ? <X className="h-4 w-4" aria-hidden="true" /> : <PenLine className="h-4 w-4" aria-hidden="true" />}
            {t("share")}
          </Button>
        )}
      </div>

      {canPost && composerOpen && (
        <div id={panelId} className="rounded-3xl border bg-card p-4 text-card-foreground sm:p-5">
          <h3 className="mb-1 font-semibold">{t("composerTitle")}</h3>
          <p className="mb-4 text-sm text-muted-foreground">{t("composerIntro")}</p>
          <PostComposer
            idPrefix={panelId}
            onPublished={published}
            onFailure={(message) => report({ type: "error", message })}
            onCancel={() => setComposerOpen(false)}
          />
        </div>
      )}

      {mode === "wall" && (
        <div className="flex flex-wrap items-end gap-3">
          <Field id={`${headingId}-type`} label={t("typeFilter")} className="min-w-44 flex-1 sm:flex-none">
            {(props) => (
              <Select {...props} value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value as PostType | "" })}>
                <option value="">{t("allTypes")}</option>
                {POST_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {tTypes(type)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {isAdmin && (
            <Field id={`${headingId}-hidden`} label={t("hiddenFilter")} className="min-w-44 flex-1 sm:flex-none">
              {(props) => (
                <Select
                  {...props}
                  value={filters.hidden}
                  onChange={(event) => setFilters({ ...filters, hidden: event.target.value as PostFilters["hidden"] })}
                >
                  <option value="">{t("hiddenAll")}</option>
                  <option value="false">{t("hiddenNo")}</option>
                  <option value="true">{t("hiddenYes")}</option>
                </Select>
              )}
            </Field>
          )}
          {filtered && (
            <Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={() => setFilters(baseFilters)}>
              <X className="h-4 w-4" aria-hidden="true" />
              {tActions("resetFilters")}
            </Button>
          )}
        </div>
      )}

      <InlineFeedback feedback={feedback} />

      <Results
        key={key}
        filters={filters}
        initial={key === initialKey ? initial : null}
        viewer={viewer}
        report={report}
        emptyTitle={filtered ? t("noResults") : t(mode === "mine" ? "mineEmpty" : "empty")}
        emptyText={filtered ? t("noResultsText") : t(mode === "mine" ? "mineEmptyText" : canPost ? "emptyTextAlumni" : "emptyText")}
      />
    </section>
  );
}
