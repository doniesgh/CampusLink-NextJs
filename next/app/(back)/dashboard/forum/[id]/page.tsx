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
import { forumHref, questionPath } from "@/lib/forum/paths";
import { isObjectId, isQuestionDetail, type QuestionDetail } from "@/lib/forum/types";
import { QuestionView } from "./question-view";

type Params = Promise<{ id: string }>;
type Loaded = { data: QuestionDetail; savedAt: number; error?: undefined } | { data?: undefined; error: ApiError };

// One backend call per request (it counts the view once per user and day), shared by generateMetadata and the page.
const loadQuestion = cache(async (id: string): Promise<Loaded> => {
  try {
    const data = await serverApi<QuestionDetail>(questionPath(id));
    if (!isQuestionDetail(data)) return { error: toApiError(new Error("Unexpected answer")) };
    return { data, savedAt: Date.now() };
  } catch (e) {
    return { error: toApiError(e) };
  }
});

const isMissing = (error: ApiError) => error.status === 404 || error.status === 400 || error.status === 403;

export async function generateMetadata({ params }: Readonly<{ params: Params }>): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("forum");
  if (!isObjectId(id)) return { title: t("questionMetaTitle") };
  const loaded = await loadQuestion(id);
  return { title: loaded.data?.question.title ?? t("questionMetaTitle") };
}

export default async function ForumQuestionPage({ params }: Readonly<{ params: Params }>) {
  const { id } = await params;
  const [{ user, error }, t] = await Promise.all([requireRole(ROLES), getTranslations("forum")]);

  if (!user) {
    const errors = await getErrorFormatter();
    return (
      <div className="container max-w-3xl space-y-6 py-6 sm:py-10">
        <PageHeader title={t("questionMetaTitle")} />
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  const loaded = isObjectId(id) ? await loadQuestion(id) : null;
  if (!loaded || (loaded.error && isMissing(loaded.error))) {
    return (
      <div className="container max-w-3xl py-6 sm:py-10">
        <ForumNotFound
          title={t("question.notFoundTitle")}
          description={t("question.notFoundText")}
          backHref={forumHref}
          backLabel={t("question.back")}
        />
      </div>
    );
  }

  // Backend unreachable: the browser shows the copy saved on this device, if any.
  return (
    <div className="container max-w-3xl py-6 sm:py-10">
      <QuestionView
        id={id}
        initial={loaded.data ? { data: loaded.data, savedAt: loaded.savedAt } : null}
        viewer={{ id: user.id, role: user.role, firstname: user.firstname, lastname: user.lastname }}
      />
    </div>
  );
}
