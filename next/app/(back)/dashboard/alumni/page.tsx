import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverSnapshot } from "@/lib/server-api";
import { ROLES } from "@/lib/types";
import { alumniSearch, filtersKey, parseDirectoryFilters, parseTab } from "@/lib/alumni/filters";
import { directoryPath, EMPTY_POST_FILTERS, FACETS_PATH, mentoringPath, postsPath } from "@/lib/alumni/paths";
import { isFacets, isList, type DirectoryList, type Facets, type MentoringList, type PostList } from "@/lib/alumni/types";
import { AlumniView } from "./alumni-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("alumni");
  return { title: t("metaTitle") };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** /dashboard/alumni (every role): directory, news wall, a student's mentoring requests, ADMIN support list. */
export default async function AlumniPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const [{ user, error }, t] = await Promise.all([requireRole(ROLES, "/dashboard/alumni"), getTranslations("alumni")]);

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
  const filters = parseDirectoryFilters(params);
  const tab = parseTab(params, user.role);
  // Everything shown first is rendered here: no API request from the browser when the page loads.
  const [directory, facets, posts, mentoring] = await Promise.all([
    serverSnapshot<DirectoryList | null>(directoryPath(filters, 1), null),
    serverSnapshot<Facets | null>(FACETS_PATH, null),
    serverSnapshot<PostList | null>(postsPath(EMPTY_POST_FILTERS, 1), null),
    user.role === "STUDENT" ? serverSnapshot<MentoringList | null>(mentoringPath("mentee", "active", 1), null) : Promise.resolve(null),
  ]);

  return (
    <div className="container py-6 sm:py-10">
      <AlumniView
        viewer={{ id: user.id, role: user.role }}
        serverSearch={alumniSearch(tab, filters)}
        initial={{
          directory: isList(directory.data) ? { data: directory.data as DirectoryList, savedAt: directory.savedAt } : null,
          directoryKey: filtersKey(filters),
          facets: isFacets(facets.data) ? { data: facets.data, savedAt: facets.savedAt } : null,
          posts: isList(posts.data) ? { data: posts.data as PostList, savedAt: posts.savedAt } : null,
          mentoring: mentoring && isList(mentoring.data) ? { data: mentoring.data as MentoringList, savedAt: mentoring.savedAt } : null,
        }}
      />
    </div>
  );
}
