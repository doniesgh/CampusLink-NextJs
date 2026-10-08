"use client";

import { useState } from "react";
import { CloudOff, Inbox, RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { MentoringCard } from "@/components/alumni/mentoring-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback, type Feedback } from "@/components/ui/feedback";
import { SkeletonList } from "@/components/ui/skeleton";
import { useErrorFormatter } from "@/lib/i18n/client";
import { invalidateQueries, useOfflineQuery, useOnlineStatus } from "@/lib/offline";
import type { Snapshot } from "@/lib/alumni/client";
import { MENTORING_PAGE_SIZE, MENTORING_VIEWS, mentoringKey, mentoringPath, type MentoringView } from "@/lib/alumni/paths";
import {
  isList,
  MAX_PENDING_PER_STUDENT,
  type MentoringList as MentoringListData,
  type MentoringRequest,
  type MentoringRole,
} from "@/lib/alumni/types";

type Changed = (request: MentoringRequest, previous: MentoringRequest) => void;

const replaced = (request: MentoringRequest) => (current: MentoringListData | undefined) =>
  current && Array.isArray(current.items) ? { ...current, items: current.items.map((item) => (item.id === request.id ? request : item)) } : current;

/** Pages 2..n ("Load more"). */
function NextPage({
  role,
  view,
  page,
  onChanged,
  report,
}: {
  role: MentoringRole;
  view: MentoringView;
  page: number;
  onChanged: Changed;
  report: (feedback: Feedback) => void;
}) {
  const t = useTranslations("alumni.mentoring");
  const tStates = useTranslations("common.states");
  const { data, isLoading, mutate } = useOfflineQuery<MentoringListData>(mentoringKey(role, view, page), mentoringPath(role, view, page));
  if (isLoading) {
    return (
      <li>
        <SkeletonList rows={2} label={tStates("loading")} />
      </li>
    );
  }
  if (!isList<MentoringRequest>(data)) return <li className="px-1 text-sm text-muted-foreground">{t("pageError")}</li>;
  return (
    <>
      {data.items.map((request) => (
        <li key={request.id}>
          <MentoringCard
            request={request}
            side={role}
            report={report}
            onChanged={(next, previous) => {
              mutate(replaced(next));
              onChanged(next, previous);
            }}
          />
        </li>
      ))}
    </>
  );
}

/**
 * Mentoring requests of the signed-in user: sent (student, `role="mentee"`) or received (alumni, `role="mentor"`).
 * Group "Show": "Active" (pending and accepted, default), "Past" (declined and closed), "All". Requests keep their
 * place when answered or closed (their status changes in place); the counts follow.
 */
export function MentoringList({
  role,
  initial,
  emptyAction,
}: {
  role: MentoringRole;
  /** First page of the "active" view, rendered by the server. */
  initial: Snapshot<MentoringListData>;
  /** Shown under the empty state (e.g. a link to the directory for students). */
  emptyAction?: React.ReactNode;
}) {
  const t = useTranslations("alumni.mentoring");
  const tStates = useTranslations("common.states");
  const tActions = useTranslations("common.actions");
  const errors = useErrorFormatter();
  const online = useOnlineStatus();
  const [view, setView] = useState<MentoringView>("active");
  const [pages, setPages] = useState(1);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const report = (value: Feedback) => setFeedback({ ...value, at: Date.now() });
  const first = useOfflineQuery<MentoringListData>(mentoringKey(role, view, 1), mentoringPath(role, view, 1), {
    fallbackData: view === "active" ? (initial?.data ?? undefined) : undefined,
    fallbackSavedAt: initial?.savedAt,
    revalidateOnMount: view !== "active" || !initial?.data,
  });

  const onChanged: Changed = (next, previous) => {
    const delta = (next.status === "PENDING" ? 1 : 0) - (previous.status === "PENDING" ? 1 : 0);
    if (delta !== 0) {
      first.mutate((current) => (current ? { ...current, pendingCount: Math.max(0, (current.pendingCount ?? 0) + delta) } : current));
    }
    // Other places that show these requests (profile pages, the student's pending count) load them again.
    invalidateQueries("alumni:mentoring:pending");
    invalidateQueries("alumni:profile");
  };

  const choose = (next: MentoringView) => {
    setView(next);
    setPages(1);
  };

  let content: React.ReactNode;
  const list = first.data;
  if (first.isLoading) {
    content = <SkeletonList rows={2} label={tStates("loading")} />;
  } else if (!isList<MentoringRequest>(list)) {
    const offline = !online || !!first.error?.isNetworkError || first.error?.code === "OFFLINE";
    content = offline ? (
      <EmptyState icon={CloudOff} title={t("notSavedTitle")} description={t("notSavedText")} headingLevel="h3" />
    ) : (
      <InlineFeedback feedback={{ type: "error", message: first.error ? `${t("loadError")} ${errors.message(first.error)}` : t("loadError") }}>
        <Button variant="outline" size="sm" className="mt-2 rounded-full" onClick={() => void first.refresh()}>
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          {tActions("tryAgain")}
        </Button>
      </InlineFeedback>
    );
  } else if (list.items.length === 0) {
    content = (
      <EmptyState
        icon={Inbox}
        title={t(`empty.${role}.${view}`)}
        description={view === "active" ? t(`emptyText.${role}`) : undefined}
        action={view === "active" ? emptyAction : undefined}
        headingLevel="h3"
      />
    );
  } else {
    const total = typeof list.total === "number" ? list.total : list.items.length;
    content = (
      <div className="space-y-3">
        <ul className="space-y-3">
          {list.items.map((request) => (
            <li key={request.id}>
              <MentoringCard
                request={request}
                side={role}
                report={report}
                onChanged={(next, previous) => {
                  first.mutate(replaced(next));
                  onChanged(next, previous);
                }}
              />
            </li>
          ))}
          {Array.from({ length: pages - 1 }, (_, index) => (
            <NextPage key={index + 2} role={role} view={view} page={index + 2} onChanged={onChanged} report={report} />
          ))}
        </ul>
        {total > pages * MENTORING_PAGE_SIZE && (
          <div className="flex justify-center">
            <Button variant="outline" className="rounded-full" onClick={() => setPages((count) => count + 1)}>
              {tActions("loadMore")}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const pendingCount = isList<MentoringRequest>(list) && typeof list.pendingCount === "number" ? list.pendingCount : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="group" aria-label={t("viewLabel")} className="inline-flex w-full rounded-full bg-muted p-1 sm:w-auto">
          {MENTORING_VIEWS.map((entry) => (
            <button
              key={entry}
              type="button"
              aria-pressed={view === entry}
              onClick={() => choose(entry)}
              className="flex-1 rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm sm:flex-none"
            >
              {t(`views.${entry}`)}
            </button>
          ))}
        </div>
        {pendingCount !== null && (
          <p className="text-sm text-muted-foreground" data-testid="pending-count">
            {role === "mentee" ? t("pendingMentee", { count: pendingCount, max: MAX_PENDING_PER_STUDENT }) : t("pendingMentor", { count: pendingCount })}
          </p>
        )}
      </div>
      <InlineFeedback feedback={feedback} />
      {content}
    </div>
  );
}
