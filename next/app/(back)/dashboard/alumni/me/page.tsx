import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverSnapshot } from "@/lib/server-api";
import type { Program } from "@/lib/types";
import { parseMeTab } from "@/lib/alumni/filters";
import { EMPTY_POST_FILTERS, FACETS_PATH, mentoringPath, MY_PROFILE_PATH, postsPath, PROGRAMS_PATH } from "@/lib/alumni/paths";
import { isFacets, isList, isProfile, type AlumniProfile, type Facets, type MentoringList, type PostList } from "@/lib/alumni/types";
import { MyProfileView } from "./my-profile-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("alumni");
  return { title: t("meMetaTitle") };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** /dashboard/alumni/me (ALUMNI; other roles are sent to /dashboard). */
export default async function MyAlumniProfilePage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const [{ user, error }, t] = await Promise.all([requireRole(["ALUMNI"], "/dashboard/alumni/me"), getTranslations("alumni")]);

  if (!user) {
    const errors = await getErrorFormatter();
    return (
      <div className="container space-y-6 py-6 sm:py-10">
        <PageHeader title={t("meTitle")} description={t("meDescription")} />
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  const tab = parseMeTab(await searchParams);
  // Everything shown first is rendered here: no API request from the browser when the page loads.
  const [profile, programs, facets, mentoring, posts] = await Promise.all([
    serverSnapshot<AlumniProfile | null>(MY_PROFILE_PATH, null),
    serverSnapshot<Program[] | null>(PROGRAMS_PATH, null),
    serverSnapshot<Facets | null>(FACETS_PATH, null),
    serverSnapshot<MentoringList | null>(mentoringPath("mentor", "active", 1), null),
    serverSnapshot<PostList | null>(postsPath({ ...EMPTY_POST_FILTERS, author: "me" }, 1), null),
  ]);

  return (
    <div className="container max-w-5xl py-6 sm:py-10">
      <MyProfileView
        viewer={{ id: user.id, role: user.role }}
        serverSearch={tab === "profile" ? "" : `tab=${tab}`}
        initial={{
          profile: isProfile(profile.data) ? { data: profile.data, savedAt: profile.savedAt } : null,
          programs: Array.isArray(programs.data) ? { data: programs.data, savedAt: programs.savedAt } : null,
          facets: isFacets(facets.data) ? { data: facets.data, savedAt: facets.savedAt } : null,
          mentoring: isList(mentoring.data) ? { data: mentoring.data as MentoringList, savedAt: mentoring.savedAt } : null,
          posts: isList(posts.data) ? { data: posts.data as PostList, savedAt: posts.savedAt } : null,
        }}
      />
    </div>
  );
}
