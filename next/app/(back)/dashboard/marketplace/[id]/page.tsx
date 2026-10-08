import { cache } from "react";
import type { Metadata } from "next";
import { ArrowLeft, SearchX } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "@/components/ui/app-link";
import { Button } from "@/components/ui/button";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { toApiError, type ApiError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { APP_TIMEZONE } from "@/lib/datetime";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverApi, serverSnapshot } from "@/lib/server-api";
import type { Subject } from "@/lib/types";
import { CONFIG_PATH, documentHref, documentPath, marketplaceHref, reviewsPath, SUBJECTS_PATH, walletPath } from "@/lib/marketplace/paths";
import {
  academicYearOf,
  isMarketDocument,
  isObjectId,
  isReviewList,
  isWallet,
  type MarketConfig,
  type MarketDocument,
  type ReviewList,
  type Wallet,
} from "@/lib/marketplace/types";
import { DocumentView } from "./document-view";

type Params = Promise<{ id: string }>;
type Loaded = { data: MarketDocument; savedAt: number; error?: undefined } | { data?: undefined; error: ApiError };

// One backend call per request, shared by generateMetadata and the page.
const loadDocument = cache(async (id: string): Promise<Loaded> => {
  try {
    const data = await serverApi<MarketDocument>(documentPath(id));
    if (!isMarketDocument(data)) return { error: toApiError(new Error("Unexpected answer")) };
    return { data, savedAt: Date.now() };
  } catch (e) {
    return { error: toApiError(e) };
  }
});

const isMissing = (error: ApiError) => error.status === 404 || error.status === 400 || error.status === 403;

export async function generateMetadata({ params }: Readonly<{ params: Params }>): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("marketplace");
  if (!isObjectId(id)) return { title: t("documentMetaTitle") };
  const loaded = await loadDocument(id);
  return { title: loaded.data?.title ?? t("documentMetaTitle") };
}

/** A document that does not exist, or that the viewer may not see (same answer, nothing leaks): the page's h1. */
async function NotFound() {
  const t = await getTranslations("marketplace.detail");
  return (
    <div className="flex flex-col items-center rounded-3xl border border-dashed bg-card px-6 py-12 text-center" data-testid="document-not-found">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-primary">
        <SearchX className="h-6 w-6" aria-hidden="true" />
      </span>
      <h1 className="mt-4 font-heading text-xl font-semibold text-foreground">{t("notFoundTitle")}</h1>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{t("notFoundText")}</p>
      <Button asChild variant="outline" className="mt-5 rounded-full">
        <Link href={marketplaceHref}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("back")}
        </Link>
      </Button>
    </div>
  );
}

/** Document page of the marketplace (STUDENT, TEACHER, ADMIN): details, buy / download, reviews, report, moderation. */
export default async function MarketplaceDocumentPage({ params }: Readonly<{ params: Params }>) {
  const { id } = await params;
  const [{ user, error }, t] = await Promise.all([
    requireRole(["STUDENT", "TEACHER", "ADMIN"], isObjectId(id) ? documentHref(id) : marketplaceHref),
    getTranslations("marketplace"),
  ]);

  if (!user) {
    const errors = await getErrorFormatter();
    return (
      <div className="container max-w-5xl space-y-6 py-6 sm:py-10">
        <PageHeader title={t("documentMetaTitle")} />
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  const loaded = isObjectId(id) ? await loadDocument(id) : null;
  if (!loaded || (loaded.error && isMissing(loaded.error))) {
    return (
      <div className="container max-w-3xl py-6 sm:py-10">
        <NotFound />
      </div>
    );
  }

  const [reviews, wallet, subjects, config] = await Promise.all([
    serverSnapshot<ReviewList | null>(reviewsPath(id, 1), null),
    serverSnapshot<Wallet | null>(walletPath(1), null),
    loaded.data?.mine ? serverSnapshot<Subject[] | null>(SUBJECTS_PATH, null) : Promise.resolve(null),
    loaded.data?.mine ? serverSnapshot<MarketConfig | null>(CONFIG_PATH, null) : Promise.resolve(null),
  ]);

  // Backend unreachable: the browser shows the copy saved on this device, if any.
  return (
    <div className="container max-w-5xl py-6 sm:py-10">
      <DocumentView
        id={id}
        initial={loaded.data ? { data: loaded.data, savedAt: loaded.savedAt } : null}
        initialReviews={isReviewList(reviews.data) ? reviews : null}
        initialWallet={isWallet(wallet.data) ? wallet : null}
        subjects={subjects && Array.isArray(subjects.data) ? subjects : null}
        config={config?.data && typeof config.data.maxUploadMb === "number" ? config : null}
        currentYear={academicYearOf(new Date(), APP_TIMEZONE)}
        viewer={{ id: user.id, role: user.role }}
      />
    </div>
  );
}
