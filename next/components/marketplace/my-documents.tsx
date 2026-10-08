"use client";

import { useState } from "react";
import { CloudOff, Download, FileUp, Library, Plus, RotateCw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { DocumentCard } from "@/components/marketplace/document-card";
import { EditDocumentDialog } from "@/components/marketplace/edit-document-dialog";
import { MarketText } from "@/components/marketplace/market-text";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback, type Feedback } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { SkeletonList } from "@/components/ui/skeleton";
import { useErrorFormatter } from "@/lib/i18n/client";
import { invalidateQueries, useOfflineQuery, useOnlineStatus } from "@/lib/offline";
import type { MineView } from "@/lib/marketplace/filters";
import { fileHref, libraryKey, libraryPath, MINE_PAGE_SIZE, mineKey, myDocumentsPath } from "@/lib/marketplace/paths";
import type { Snapshot } from "@/lib/marketplace/queries";
import { DOCUMENT_STATUSES, isDocumentList, type DocumentList, type DocumentStatus, type MarketDocument } from "@/lib/marketplace/types";
import type { Subject } from "@/lib/types";
import { cn } from "@/lib/utils";
import { deleteDocumentAction } from "@/app/(back)/dashboard/marketplace/actions";

type Shared = {
  subjects: Subject[];
  currentYear: string;
  maxUploadMb: number;
  isAdmin: boolean;
  onFeedback: (feedback: Feedback) => void;
};

/** Reason of a rejection / unpublication, and the actions of the author ("Edit", "Delete"). */
function MyDocumentExtras({ document, shared }: { document: MarketDocument; shared: Shared }) {
  const t = useTranslations("marketplace.mine");
  const errors = useErrorFormatter();
  const online = useOnlineStatus();

  const remove = async () => {
    try {
      const result = await deleteDocumentAction(document.id);
      if (result.ok) {
        invalidateQueries("marketplace");
        shared.onFeedback({ type: "success", message: result.message ?? t("deleted") });
      } else {
        shared.onFeedback({ type: "error", message: result.message ?? errors.forCode("GENERIC") });
      }
    } catch {
      shared.onFeedback({ type: "error", message: errors.forCode("NETWORK_ERROR") });
    }
  };

  return (
    <>
      {document.status === "PENDING_REVIEW" && <p className="text-sm text-muted-foreground">{t("pendingHint")}</p>}
      {(document.status === "REJECTED" || document.status === "UNPUBLISHED") && (
        <div className="rounded-xl bg-muted/60 px-3 py-2" data-testid="rejection-reason">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {document.status === "REJECTED" ? t("rejectedReason") : t("unpublishedReason")}
          </p>
          {document.rejectionReason ? (
            <MarketText text={document.rejectionReason} />
          ) : (
            <p className="text-sm text-muted-foreground">{t("noReason")}</p>
          )}
          {document.status === "REJECTED" && <p className="mt-1 text-sm text-muted-foreground">{t("rejectedHint")}</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {document.canDownload !== false && (
          <Button asChild variant="outline" size="sm" className="rounded-full">
            <a href={fileHref(document.id)} download>
              <Download className="h-4 w-4" aria-hidden="true" />
              {t("openFile")}
              <span className="sr-only">: {document.title}</span>
            </a>
          </Button>
        )}
        {online && (
          <EditDocumentDialog
            document={document}
            subjects={shared.subjects}
            currentYear={shared.currentYear}
            maxUploadMb={shared.maxUploadMb}
            isAdmin={shared.isAdmin}
            onSaved={(_saved, message) => {
              invalidateQueries("marketplace");
              shared.onFeedback({ type: "success", message: message ?? t("saved") });
            }}
          />
        )}
        {online && (
          <ConfirmDialog
            trigger={
              <Button type="button" variant="outline" size="sm" className="rounded-full text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {t("delete")}
                <span className="sr-only">: {document.title}</span>
              </Button>
            }
            title={t("deleteTitle", { title: document.title })}
            description={t("deleteDescription")}
            confirmLabel={t("confirmDelete")}
            onConfirm={remove}
          />
        )}
      </div>
    </>
  );
}

/** A list that could not be loaded: offline (never saved on this device) or a server error. */
function ListState({ error, refresh }: { error: { isNetworkError?: boolean; code?: string } | null; refresh: () => Promise<void> }) {
  const t = useTranslations("marketplace.mine");
  const tActions = useTranslations("common.actions");
  const online = useOnlineStatus();
  const offline = !online || !!error?.isNetworkError || error?.code === "OFFLINE";
  if (offline) return <EmptyState icon={CloudOff} title={t("notSavedTitle")} description={t("notSavedText")} />;
  return (
    <InlineFeedback feedback={{ type: "error", message: t("loadError") }}>
      <Button variant="outline" size="sm" className="mt-2 rounded-full" onClick={() => void refresh()}>
        <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
        {tActions("tryAgain")}
      </Button>
    </InlineFeedback>
  );
}

const listQuery = (view: MineView, status: DocumentStatus | "", page: number) =>
  view === "shared" ? { key: mineKey(status, page), path: myDocumentsPath(status, page) } : { key: libraryKey(page), path: libraryPath(page) };

/** One document of a list: my uploads get their status, reason and actions; my library gets "Download". */
function ListItem({ document, view, shared }: { document: MarketDocument; view: MineView; shared: Shared }) {
  const t = useTranslations("marketplace.mine");
  return (
    <li>
      <DocumentCard document={document} showStatus={view === "shared"} showOwnership={false}>
        {view === "shared" ? (
          <MyDocumentExtras document={document} shared={shared} />
        ) : (
          document.canDownload && (
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <a href={fileHref(document.id)} download>
                <Download className="h-4 w-4" aria-hidden="true" />
                {t("download")}
                <span className="sr-only">: {document.title}</span>
              </a>
            </Button>
          )
        )}
      </DocumentCard>
    </li>
  );
}

/** Pages 2..n ("Load more"), each its own offline query. */
function NextPage({ view, status, page, shared }: { view: MineView; status: DocumentStatus | ""; page: number; shared: Shared }) {
  const t = useTranslations("marketplace.mine");
  const tStates = useTranslations("common.states");
  const { key, path } = listQuery(view, status, page);
  const { data, isLoading } = useOfflineQuery<DocumentList>(key, path);
  if (isLoading) {
    return (
      <li className="lg:col-span-2">
        <SkeletonList rows={2} label={tStates("loading")} />
      </li>
    );
  }
  if (!isDocumentList(data)) return <li className="px-1 text-sm text-muted-foreground lg:col-span-2">{t("pageError")}</li>;
  return (
    <>
      {data.items.map((doc) => (
        <ListItem key={doc.id} document={doc} view={view} shared={shared} />
      ))}
    </>
  );
}

/** One list (shared with a status, or library): first page from the server or IndexedDB, then "Load more". */
function DocumentsList({
  view,
  status,
  initial,
  shared,
  onShare,
}: {
  view: MineView;
  status: DocumentStatus | "";
  initial?: Snapshot<DocumentList>;
  shared: Shared;
  onShare: () => void;
}) {
  const t = useTranslations("marketplace.mine");
  const tStates = useTranslations("common.states");
  const tActions = useTranslations("common.actions");
  const [pages, setPages] = useState(1);
  const { key, path } = listQuery(view, status, 1);
  const first = useOfflineQuery<DocumentList>(key, path, {
    fallbackData: initial?.data ?? undefined,
    fallbackSavedAt: initial?.savedAt,
    revalidateOnMount: !initial?.data,
  });

  if (first.isLoading) return <SkeletonList rows={3} label={tStates("loading")} />;
  const list = isDocumentList(first.data) ? first.data : undefined;
  if (!list) return <ListState error={first.error} refresh={first.refresh} />;
  if (list.items.length === 0) {
    if (view === "library") return <EmptyState icon={Library} title={t("libraryEmpty")} description={t("libraryEmptyText")} />;
    if (status) return <EmptyState icon={FileUp} title={t("noneWithStatus")} />;
    return (
      <EmptyState
        icon={FileUp}
        title={t("sharedEmpty")}
        description={t("sharedEmptyText")}
        action={
          <Button className="rounded-full" onClick={onShare}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("shareFirst")}
          </Button>
        }
      />
    );
  }

  const total = list.total ?? list.items.length;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground" data-testid="mine-count">
        {t(view === "shared" ? "sharedCount" : "libraryCount", { count: total })}
      </p>
      <ul className="grid gap-3 lg:grid-cols-2" aria-label={view === "shared" ? t("sharedTitle") : t("libraryTitle")}>
        {list.items.map((doc) => (
          <ListItem key={doc.id} document={doc} view={view} shared={shared} />
        ))}
        {Array.from({ length: pages - 1 }, (_, index) => (
          <NextPage key={index + 2} view={view} status={status} page={index + 2} shared={shared} />
        ))}
      </ul>
      {total > pages * MINE_PAGE_SIZE && (
        <div className="flex justify-center">
          <Button variant="outline" className="rounded-full" onClick={() => setPages((count) => count + 1)}>
            {tActions("loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}

const TOGGLE =
  "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * "My documents" tab: "Shared by me" (every status, with the reason of a rejection, "Edit" and "Delete") and
 * "Bought or downloaded" (my library, with "Download").
 */
export function MyDocuments({
  view,
  status,
  initialShared,
  initialLibrary,
  onChange,
  onShare,
  ...shared
}: Shared & {
  view: MineView;
  status: DocumentStatus | "";
  /** Server data for the view and status of the URL. */
  initialShared?: Snapshot<DocumentList>;
  initialLibrary?: Snapshot<DocumentList>;
  onChange: (patch: { view?: MineView; status?: DocumentStatus | "" }) => void;
  onShare: () => void;
}) {
  const t = useTranslations("marketplace.mine");
  const tStatus = useTranslations("marketplace.status");
  return (
    <section aria-labelledby="market-mine-title" className="space-y-4">
      <h2 id="market-mine-title" className="sr-only">
        {t("title")}
      </h2>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div role="group" aria-label={t("show")} className="inline-flex items-center gap-1 rounded-full bg-muted p-1">
          {(["shared", "library"] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              aria-pressed={view === entry}
              onClick={() => onChange({ view: entry })}
              className={cn(TOGGLE, view === entry ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {entry === "shared" ? t("sharedTitle") : t("libraryTitle")}
            </button>
          ))}
        </div>
        {view === "shared" && (
          <Field id="market-mine-status" label={t("status")} className="w-full sm:w-56">
            {(props) => (
              <Select {...props} value={status} onChange={(event) => onChange({ status: event.target.value as DocumentStatus | "" })}>
                <option value="">{t("allStatuses")}</option>
                {DOCUMENT_STATUSES.map((entry) => (
                  <option key={entry} value={entry}>
                    {tStatus(entry)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>
      <DocumentsList
        key={`${view}:${status}`}
        view={view}
        status={view === "shared" ? status : ""}
        initial={view === "shared" ? initialShared : initialLibrary}
        shared={shared}
        onShare={onShare}
      />
    </section>
  );
}
