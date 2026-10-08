"use client";

import { useCallback, useMemo } from "react";
import { Coins, FolderOpen, Plus, Search, Upload, WalletCards, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { BrowsePanel } from "@/components/marketplace/browse-panel";
import { DocumentForm } from "@/components/marketplace/document-form";
import { MyDocuments } from "@/components/marketplace/my-documents";
import { WalletPanel } from "@/components/marketplace/wallet-panel";
import { Button } from "@/components/ui/button";
import { InlineFeedback, useFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { invalidateQueries } from "@/lib/offline";
import { setSearch, useLocationSearch } from "@/lib/timetable/client";
import {
  marketSearch,
  normalizeFilters,
  parseMarketUrl,
  type BrowseFilters,
  type MarketTab,
  type MarketUrlState,
} from "@/lib/marketplace/filters";
import { useMarketConfig, useMarketSubjects, useWallet, type Snapshot } from "@/lib/marketplace/queries";
import type { DocumentList, MarketConfig, Wallet } from "@/lib/marketplace/types";
import type { Role, Subject } from "@/lib/types";
import { uploadDocumentAction } from "./actions";

export type MarketInitial = {
  /** First page of "Browse" for the filters of the address (when it opened on that tab). */
  list: Snapshot<DocumentList>;
  /** First page of "My documents" for the view and status of the address. */
  shared: Snapshot<DocumentList>;
  library: Snapshot<DocumentList>;
  wallet: Snapshot<Wallet>;
  subjects: Snapshot<Subject[]>;
  config: Snapshot<MarketConfig>;
};

/** Balance in the header: opens the "Wallet" tab. */
function BalanceButton({ balance, onOpen }: { balance: number | undefined; onOpen: () => void }) {
  const t = useTranslations("marketplace");
  if (balance === undefined) return null;
  return (
    <Button type="button" variant="outline" className="rounded-full" onClick={onOpen} data-testid="header-balance">
      <Coins className="h-4 w-4 text-highlight" aria-hidden="true" />
      <span className="sr-only">{t("balanceLabel")} </span>
      {t("tokens", { count: balance })}
    </Button>
  );
}

/**
 * /dashboard/marketplace: tabs "Browse" (search, filters, documents), "My documents" (what I shared, with its
 * status, and what I bought or downloaded) and "Wallet" (balance + history), plus the "Share a document" form.
 * The tab, the filters and the form state live in the URL (no server round trip); reads go through the offline
 * data layer, mutations through Server Actions.
 */
export function MarketplaceView({
  role,
  serverSearch,
  currentYear,
  initial,
}: {
  role: Role;
  /** Query string the server rendered. */
  serverSearch: string;
  currentYear: string;
  initial: MarketInitial;
}) {
  const t = useTranslations("marketplace");
  const tTabs = useTranslations("marketplace.tabs");
  const tUpload = useTranslations("marketplace.upload");
  const [feedback, setFeedback] = useFeedback();
  const search = useLocationSearch(serverSearch);
  const url = useMemo(() => parseMarketUrl(new URLSearchParams(search)), [search]);
  const serverUrl = useMemo(() => parseMarketUrl(new URLSearchParams(serverSearch)), [serverSearch]);
  const subjects = useMarketSubjects(initial.subjects);
  const config = useMarketConfig(initial.config);
  const wallet = useWallet(initial.wallet);
  const isAdmin = role === "ADMIN";

  const navigate = useCallback((patch: Partial<MarketUrlState>) => {
    const current = parseMarketUrl(new URLSearchParams(window.location.search));
    setSearch(marketSearch({ ...current, ...patch }), { replace: true });
  }, []);
  const applyFilters = useCallback((filters: BrowseFilters) => navigate({ filters: normalizeFilters(filters) }), [navigate]);

  const toggleUpload = () => {
    const next = !url.upload;
    navigate({ upload: next });
    if (next) requestAnimationFrame(() => document.getElementById("share-title")?.focus());
  };

  const sameMine = serverUrl.tab === "mine" && serverUrl.view === url.view && serverUrl.status === url.status;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <BalanceButton balance={wallet.data?.balance} onOpen={() => navigate({ tab: "wallet", upload: false })} />
            <Button
              type="button"
              className="rounded-full"
              aria-expanded={url.upload}
              aria-controls="share-document-panel"
              onClick={toggleUpload}
            >
              {url.upload ? <X className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
              {tUpload("open")}
            </Button>
          </>
        }
      />

      <InlineFeedback feedback={feedback} />

      {url.upload && (
        <section
          id="share-document-panel"
          aria-labelledby="share-document-title"
          className="rounded-3xl border bg-card p-5 text-card-foreground sm:p-6"
        >
          <h2 id="share-document-title" className="flex items-center gap-2 text-lg font-semibold">
            <Upload className="h-5 w-5 text-primary" aria-hidden="true" />
            {tUpload("title")}
          </h2>
          <p className="mb-5 mt-1 text-sm text-muted-foreground">{tUpload("intro")}</p>
          <DocumentForm
            idPrefix="share"
            subjects={subjects}
            currentYear={currentYear}
            maxUploadMb={config.maxUploadMb}
            isAdmin={isAdmin}
            defaults={{ subject: url.filters.subject, type: url.filters.type, level: url.filters.level }}
            submit={({ formData }) => (formData ? uploadDocumentAction(formData) : Promise.resolve({ ok: false }))}
            onDone={(_document, message) => {
              invalidateQueries("marketplace");
              navigate({ upload: false, tab: "mine", view: "shared", status: "" });
              setFeedback({ type: "success", message: message ?? tUpload("sent") });
            }}
            onFailure={(message) => setFeedback({ type: "error", message })}
            onCancel={() => navigate({ upload: false })}
          />
        </section>
      )}

      <Tabs value={url.tab} onValueChange={(value) => navigate({ tab: value as MarketTab })}>
        <TabsList aria-label={tTabs("label")} className="flex w-full sm:inline-flex sm:w-auto">
          <TabsTrigger value="browse" className="flex-1 px-3 sm:flex-none sm:px-4">
            <Search className="hidden h-4 w-4 sm:block" aria-hidden="true" />
            {tTabs("browse")}
          </TabsTrigger>
          <TabsTrigger value="mine" className="flex-1 px-3 sm:flex-none sm:px-4">
            <FolderOpen className="hidden h-4 w-4 sm:block" aria-hidden="true" />
            {tTabs("mine")}
          </TabsTrigger>
          <TabsTrigger value="wallet" className="flex-1 px-3 sm:flex-none sm:px-4">
            <WalletCards className="hidden h-4 w-4 sm:block" aria-hidden="true" />
            {tTabs("wallet")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="browse">
          <BrowsePanel
            filters={url.filters}
            initialFilters={serverUrl.filters}
            initial={serverUrl.tab === "browse" ? initial.list : null}
            subjects={subjects}
            currentYear={currentYear}
            onApply={applyFilters}
          />
        </TabsContent>
        <TabsContent value="mine">
          <MyDocuments
            view={url.view}
            status={url.status}
            initialShared={sameMine && url.view === "shared" ? initial.shared : undefined}
            initialLibrary={sameMine && url.view === "library" ? initial.library : undefined}
            onChange={(patch) => navigate(patch)}
            onShare={() => {
              navigate({ upload: true });
              requestAnimationFrame(() => document.getElementById("share-title")?.focus());
            }}
            subjects={subjects}
            currentYear={currentYear}
            maxUploadMb={config.maxUploadMb}
            isAdmin={isAdmin}
            onFeedback={setFeedback}
          />
        </TabsContent>
        <TabsContent value="wallet">
          <WalletPanel initial={initial.wallet} startingTokens={config.startingTokens} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
