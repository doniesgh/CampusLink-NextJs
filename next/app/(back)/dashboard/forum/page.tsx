import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverSnapshot } from "@/lib/server-api";
import { ROLES, type Subject } from "@/lib/types";
import { filtersToSearch, parseFilters } from "@/lib/forum/filters";
import { LEADERBOARD_PATH, questionsPath, SUBJECTS_PATH, tagsPath } from "@/lib/forum/paths";
import { isQuestionList, type Leaderboard, type QuestionList, type TagCount } from "@/lib/forum/types";
import { ForumView } from "./forum-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("forum");
  return { title: t("metaTitle") };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

export default async function ForumPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const [{ user, error }, t] = await Promise.all([requireRole(ROLES), getTranslations("forum")]);

  if (!user) {
    const errors = await getErrorFormatter();
    return (
      <div className="container space-y-6 py-6 sm:py-10">
        <PageHeader title={t("title")} description={t("description")} />
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  const params = await searchParams;
  const filters = parseFilters(params);
  // Everything shown first is rendered here: no API request from the browser when the page loads.
  const [list, subjects, tags, leaderboard] = await Promise.all([
    serverSnapshot<QuestionList | null>(questionsPath(filters, 1), null),
    serverSnapshot<Subject[] | null>(SUBJECTS_PATH, null),
    serverSnapshot<TagCount[] | null>(tagsPath(filters.subject), null),
    serverSnapshot<Leaderboard | null>(LEADERBOARD_PATH, null),
  ]);

  return (
    <div className="container py-6 sm:py-10">
      <ForumView
        // A link to other filters (e.g. a tag of a question page) renders the list again from scratch.
        key={filtersToSearch(filters).toString()}
        filters={filters}
        initial={{
          list: isQuestionList(list.data) ? { data: list.data, savedAt: list.savedAt } : null,
          subjects: Array.isArray(subjects.data) ? subjects : null,
          tags: Array.isArray(tags.data) ? tags : null,
          leaderboard: leaderboard.data && Array.isArray(leaderboard.data.items) ? leaderboard : null,
        }}
        viewerId={user.id}
        openAsk={first(params.ask) === "1"}
        done={first(params.done) === "deleted" ? "deleted" : null}
      />
    </div>
  );
}
