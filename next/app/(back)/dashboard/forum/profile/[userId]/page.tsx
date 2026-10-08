import { cache } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForumNotFound } from "@/components/forum/not-found-state";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { toApiError, type ApiError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverApi } from "@/lib/server-api";
import { ROLES } from "@/lib/types";
import { forumHref, profilePath } from "@/lib/forum/paths";
import { isObjectId, isProfile, type ForumProfile } from "@/lib/forum/types";
import { ProfileView } from "./profile-view";

type Params = Promise<{ userId: string }>;
type Loaded = { data: ForumProfile; error?: undefined } | { data?: undefined; error: ApiError };

/** "me" is the signed-in user; anything else must be a user id. */
const isProfileId = (value: string) => value === "me" || isObjectId(value);

// One backend call per request, shared by generateMetadata and the page.
const loadProfile = cache(async (userId: string): Promise<Loaded> => {
  try {
    const data = await serverApi<ForumProfile>(profilePath(userId));
    return isProfile(data) ? { data } : { error: toApiError(new Error("Unexpected answer")) };
  } catch (e) {
    return { error: toApiError(e) };
  }
});

export async function generateMetadata({ params }: Readonly<{ params: Params }>): Promise<Metadata> {
  const { userId } = await params;
  const t = await getTranslations("forum");
  if (!isProfileId(userId)) return { title: t("profileMetaTitle") };
  const user = (await loadProfile(userId)).data?.user;
  const name = user ? `${user.firstname} ${user.lastname}`.trim() : "";
  return { title: name ? t("profileMetaTitleNamed", { name }) : t("profileMetaTitle") };
}

export default async function ForumProfilePage({ params }: Readonly<{ params: Params }>) {
  const { userId } = await params;
  const [{ user, error }, t] = await Promise.all([requireRole(ROLES), getTranslations("forum")]);
  const errors = await getErrorFormatter();

  if (!user) {
    return (
      <div className="container max-w-4xl space-y-6 py-6 sm:py-10">
        <PageHeader title={t("profileMetaTitle")} />
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  const loaded = isProfileId(userId) ? await loadProfile(userId) : null;
  if (!loaded || loaded.error?.status === 404 || loaded.error?.status === 400) {
    return (
      <div className="container max-w-4xl py-6 sm:py-10">
        <ForumNotFound title={t("profile.notFoundTitle")} description={t("profile.notFoundText")} backHref={forumHref} backLabel={t("profile.back")} />
      </div>
    );
  }

  if (!loaded.data) {
    return (
      <div className="container max-w-4xl space-y-6 py-6 sm:py-10">
        <PageHeader title={t("profileMetaTitle")} />
        <InlineFeedback feedback={{ type: "error", message: `${t("profile.loadError")} ${errors.message(loaded.error)}` }} />
      </div>
    );
  }

  return (
    <div className="container max-w-4xl py-6 sm:py-10">
      <ProfileView profile={loaded.data} isSelf={loaded.data.user.id === user.id} />
    </div>
  );
}
