import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/dal";
import { APP_TIMEZONE } from "@/lib/datetime";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverSnapshot } from "@/lib/server-api";
import type { Subject } from "@/lib/types";
import { marketSearch, parseMarketUrl } from "@/lib/marketplace/filters";
import { CONFIG_PATH, documentsPath, libraryPath, marketplaceHref, myDocumentsPath, SUBJECTS_PATH, walletPath } from "@/lib/marketplace/paths";
import {
  academicYearOf,
  isDocumentList,
  isWallet,
  type DocumentList,
  type MarketConfig,
  type Wallet,
} from "@/lib/marketplace/types";
import { MarketplaceView } from "./marketplace-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketplace");
  return { title: t("metaTitle") };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const NONE = Promise.resolve(null);

/**
 * Course notes marketplace (Module 3) for students, teachers and admins (ALUMNI are sent to /dashboard).
 * The server renders the data of the tab in the address, the wallet, the subjects and the form limits, so the
 * page makes no API request from the browser when it loads.
 */
export default async function MarketplacePage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const [{ user, error }, t, params] = await Promise.all([
    requireRole(["STUDENT", "TEACHER", "ADMIN"], marketplaceHref),
    getTranslations("marketplace"),
    searchParams,
  ]);

  if (!user) {
    const errors = await getErrorFormatter();
    return (
      <div className="container space-y-6 py-6 sm:py-10">
        <PageHeader title={t("title")} description={t("description")} />
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  const url = parseMarketUrl(params);
  const [list, shared, library, wallet, subjects, config] = await Promise.all([
    url.tab === "browse" ? serverSnapshot<DocumentList | null>(documentsPath(url.filters, 1), null) : NONE,
    url.tab === "mine" && url.view === "shared" ? serverSnapshot<DocumentList | null>(myDocumentsPath(url.status, 1), null) : NONE,
    url.tab === "mine" && url.view === "library" ? serverSnapshot<DocumentList | null>(libraryPath(1), null) : NONE,
    serverSnapshot<Wallet | null>(walletPath(1), null),
    serverSnapshot<Subject[] | null>(SUBJECTS_PATH, null),
    serverSnapshot<MarketConfig | null>(CONFIG_PATH, null),
  ]);
  const listSnapshot = (snapshot: { data: DocumentList | null; savedAt: number } | null) =>
    snapshot && isDocumentList(snapshot.data) ? snapshot : null;

  return (
    <div className="container py-6 sm:py-10">
      <MarketplaceView
        role={user.role}
        serverSearch={marketSearch(url)}
        currentYear={academicYearOf(new Date(), APP_TIMEZONE)}
        initial={{
          list: listSnapshot(list),
          shared: listSnapshot(shared),
          library: listSnapshot(library),
          wallet: isWallet(wallet.data) ? wallet : null,
          subjects: Array.isArray(subjects.data) ? subjects : null,
          config: config.data && typeof config.data.maxUploadMb === "number" ? config : null,
        }}
      />
    </div>
  );
}
