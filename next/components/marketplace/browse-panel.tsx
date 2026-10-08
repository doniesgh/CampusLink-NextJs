"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { CloudOff, FileSearch, RotateCw, Search, SearchX, SlidersHorizontal, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { DocumentCard } from "@/components/marketplace/document-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SkeletonList } from "@/components/ui/skeleton";
import { useErrorFormatter } from "@/lib/i18n/client";
import { useOfflineQuery, useOnlineStatus } from "@/lib/offline";
import {
  EMPTY_FILTERS,
  effectiveSort,
  isFiltered,
  matchesLocally,
  PRICES,
  sortLocally,
  sortOptions,
  type BrowseFilters,
  type MarketSort,
  type PriceFilter,
} from "@/lib/marketplace/filters";
import { BROWSE_PAGE_SIZE, documentsPath, listKey } from "@/lib/marketplace/paths";
import type { Snapshot } from "@/lib/marketplace/queries";
import {
  DOCUMENT_TYPES,
  isDocumentList,
  LEVELS,
  PROFESSOR_MAX_LENGTH,
  recentAcademicYears,
  SEARCH_MAX_LENGTH,
  type DocumentList,
  type DocumentType,
} from "@/lib/marketplace/types";
import type { Subject } from "@/lib/types";
import { cn } from "@/lib/utils";

const DEFAULT_LIST_KEY = listKey(EMPTY_FILTERS, 1);
const PROFESSOR_DEBOUNCE_MS = 450;
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

/** Pages 2..n of the results ("Load more"), each its own offline query. */
function NextResultsPage({ filters, page }: { filters: BrowseFilters; page: number }) {
  const t = useTranslations("marketplace.browse");
  const tStates = useTranslations("common.states");
  const { data, isLoading } = useOfflineQuery<DocumentList>(listKey(filters, page), documentsPath(filters, page));
  if (isLoading) {
    return (
      <li className="sm:col-span-2 xl:col-span-3">
        <SkeletonList rows={2} label={tStates("loading")} />
      </li>
    );
  }
  if (!isDocumentList(data)) return <li className="px-1 text-sm text-muted-foreground sm:col-span-2 xl:col-span-3">{t("pageError")}</li>;
  return (
    <>
      {data.items.map((doc) => (
        <li key={doc.id}>
          <DocumentCard document={doc} />
        </li>
      ))}
    </>
  );
}

/** Results of the current filters: first page from the server (or IndexedDB), "Load more", offline fallbacks. */
function Results({ filters, initial, onReset }: { filters: BrowseFilters; initial: Snapshot<DocumentList>; onReset: () => void }) {
  const t = useTranslations("marketplace.browse");
  const tStates = useTranslations("common.states");
  const tActions = useTranslations("common.actions");
  const errors = useErrorFormatter();
  const online = useOnlineStatus();
  const [pages, setPages] = useState(1);

  const first = useOfflineQuery<DocumentList>(listKey(filters, 1), documentsPath(filters, 1), {
    fallbackData: initial?.data ?? undefined,
    fallbackSavedAt: initial?.savedAt,
    revalidateOnMount: !initial?.data,
  });
  // Offline, a filter combination never loaded on this device: filter the saved default list instead.
  const offline = !online || !!first.error?.isNetworkError || first.error?.code === "OFFLINE";
  const fallBack = isFiltered(filters) && !first.data && !first.isLoading && offline;
  const saved = useOfflineQuery<DocumentList>(DEFAULT_LIST_KEY, fallBack ? documentsPath(EMPTY_FILTERS, 1) : null, {
    revalidateOnMount: false,
  });

  if (first.isLoading || (fallBack && saved.isLoading)) return <SkeletonList rows={4} label={tStates("loading")} />;

  const list = isDocumentList(first.data) ? first.data : fallBack && isDocumentList(saved.data) ? saved.data : undefined;
  if (!list) {
    if (offline) return <EmptyState icon={CloudOff} title={t("notSavedTitle")} description={t("notSavedText")} />;
    return (
      <InlineFeedback feedback={{ type: "error", message: first.error ? `${t("loadError")} ${errors.message(first.error)}` : t("loadError") }}>
        <Button variant="outline" size="sm" className="mt-2 rounded-full" onClick={() => void first.refresh()}>
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          {tActions("tryAgain")}
        </Button>
      </InlineFeedback>
    );
  }

  const usingFallback = !isDocumentList(first.data);
  const items = usingFallback ? sortLocally(list.items.filter((doc) => matchesLocally(doc, filters)), filters) : list.items;
  const total = usingFallback ? items.length : (list.total ?? items.length);

  if (items.length === 0) {
    return isFiltered(filters) ? (
      <EmptyState
        icon={SearchX}
        title={t("noResults")}
        description={usingFallback ? t("offlineFiltered") : t("noResultsText")}
        action={
          <Button variant="outline" className="rounded-full" onClick={onReset}>
            <X className="h-4 w-4" aria-hidden="true" />
            {tActions("resetFilters")}
          </Button>
        }
      />
    ) : (
      <EmptyState icon={FileSearch} title={t("empty")} description={t("emptyText")} />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground" data-testid="market-count" aria-live="polite">
        {t("count", { count: total })}
      </p>
      {usingFallback && <p className="rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground">{t("offlineFiltered")}</p>}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={t("resultsLabel")}>
        {items.map((doc) => (
          <li key={doc.id}>
            <DocumentCard document={doc} />
          </li>
        ))}
        {!usingFallback && Array.from({ length: pages - 1 }, (_, index) => <NextResultsPage key={index + 2} filters={filters} page={index + 2} />)}
      </ul>
      {!usingFallback && total > pages * BROWSE_PAGE_SIZE && (
        <div className="flex justify-center">
          <Button variant="outline" className="rounded-full" onClick={() => setPages((count) => count + 1)}>
            {tActions("loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * "Browse" tab: search (title, professor, description), filters "Subject", "Type", "Level", "Price", "Academic
 * year", "Professor", "Sort by", and the documents as cards. Filters live in the URL (no server round trip).
 */
export function BrowsePanel({
  filters,
  initialFilters,
  initial,
  subjects,
  currentYear,
  onApply,
}: {
  filters: BrowseFilters;
  /** Filters the server rendered `initial` for. */
  initialFilters: BrowseFilters;
  initial: Snapshot<DocumentList>;
  subjects: Subject[];
  currentYear: string;
  onApply: (filters: BrowseFilters) => void;
}) {
  const t = useTranslations("marketplace");
  const tBrowse = useTranslations("marketplace.browse");
  const tActions = useTranslations("common.actions");
  const [searchText, setSearchText] = useState(filters.q);
  const [professorText, setProfessorText] = useState(filters.professor);
  // Phones: the filters fold under a "Filters" button (always shown from md up).
  const [filtersOpen, setFiltersOpen] = useState(false);

  // The URL changed from elsewhere (reset, back button): show its values in the text inputs (not while typing).
  const [shown, setShown] = useState({ q: filters.q, professor: filters.professor });
  if (shown.q !== filters.q || shown.professor !== filters.professor) {
    setShown({ q: filters.q, professor: filters.professor });
    if (oneLine(searchText) !== filters.q) setSearchText(filters.q);
    if (oneLine(professorText) !== filters.professor) setProfessorText(filters.professor);
  }

  // "Professor" filters while typing (debounced), with the filters current at that time.
  const applyProfessor = useEffectEvent((value: string) => {
    if (value !== filters.professor) onApply({ ...filters, professor: value });
  });
  useEffect(() => {
    const value = oneLine(professorText);
    const timer = setTimeout(() => applyProfessor(value), PROFESSOR_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [professorText]);

  const apply = (patch: Partial<BrowseFilters>) => onApply({ ...filters, ...patch });
  const activeCount = (["subject", "type", "level", "price", "year", "professor", "sort"] as const).filter((name) => filters[name]).length;
  const reset = () => onApply(EMPTY_FILTERS);
  const years = recentAcademicYears(currentYear);
  const yearOptions = filters.year && !years.includes(filters.year) ? [filters.year, ...years] : years;
  const resultsKey = listKey(filters, 1).join("|");
  const initialKey = listKey(initialFilters, 1).join("|");

  return (
    <div className="space-y-5">
      <section aria-labelledby="market-filters-title" className="space-y-4 rounded-3xl border bg-card p-4 text-card-foreground sm:p-5">
        <h2 id="market-filters-title" className="sr-only">
          {tBrowse("filtersTitle")}
        </h2>
        <form
          role="search"
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            apply({ q: searchText });
          }}
        >
          <label htmlFor="market-search" className="sr-only">
            {tBrowse("search")}
          </label>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="market-search"
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder={tBrowse("searchPlaceholder")}
              maxLength={SEARCH_MAX_LENGTH}
              className="pl-9"
            />
          </div>
          <Button type="submit" className="shrink-0">
            {tBrowse("searchButton")}
          </Button>
        </form>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full md:hidden"
          aria-expanded={filtersOpen}
          aria-controls="market-filters"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          {tBrowse("filters")}
          {activeCount > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
              {activeCount}
              <span className="sr-only"> {tBrowse("filtersActive", { count: activeCount })}</span>
            </span>
          )}
        </Button>

        <div id="market-filters" className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4", !filtersOpen && "hidden md:grid")}>
          <Field id="market-subject" label={tBrowse("subject")}>
            {(props) => (
              <Select {...props} value={filters.subject} onChange={(event) => apply({ subject: event.target.value })}>
                <option value="">{tBrowse("allSubjects")}</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="market-type" label={tBrowse("type")}>
            {(props) => (
              <Select {...props} value={filters.type} onChange={(event) => apply({ type: event.target.value as DocumentType | "" })}>
                <option value="">{tBrowse("allTypes")}</option>
                {DOCUMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`types.${type}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="market-level" label={tBrowse("level")}>
            {(props) => (
              <Select {...props} value={filters.level} onChange={(event) => apply({ level: event.target.value })}>
                <option value="">{tBrowse("allLevels")}</option>
                {LEVELS.map((level) => (
                  <option key={level} value={String(level)}>
                    {t("levelValue", { level })}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="market-price" label={tBrowse("price")}>
            {(props) => (
              <Select {...props} value={filters.price} onChange={(event) => apply({ price: event.target.value as PriceFilter | "" })}>
                <option value="">{tBrowse("allPrices")}</option>
                {PRICES.map((price) => (
                  <option key={price} value={price}>
                    {tBrowse(`prices.${price}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="market-year" label={tBrowse("year")}>
            {(props) => (
              <Select {...props} value={filters.year} onChange={(event) => apply({ year: event.target.value })}>
                <option value="">{tBrowse("allYears")}</option>
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="market-professor" label={tBrowse("professor")}>
            {(props) => (
              <Input
                {...props}
                type="text"
                value={professorText}
                maxLength={PROFESSOR_MAX_LENGTH}
                placeholder={tBrowse("professorPlaceholder")}
                onChange={(event) => setProfessorText(event.target.value)}
                autoComplete="off"
              />
            )}
          </Field>
          <Field id="market-sort" label={tBrowse("sort")} className="sm:col-span-2">
            {(props) => (
              <Select {...props} value={effectiveSort(filters)} onChange={(event) => apply({ sort: event.target.value as MarketSort })}>
                {sortOptions(filters).map((sort) => (
                  <option key={sort} value={sort}>
                    {tBrowse(`sorts.${sort}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        {isFiltered(filters) && (
          <div className="flex justify-end">
            <Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={reset}>
              <X className="h-4 w-4" aria-hidden="true" />
              {tActions("resetFilters")}
            </Button>
          </div>
        )}
      </section>

      <section aria-labelledby="market-results-title" className="space-y-3">
        <h2 id="market-results-title" className="sr-only">
          {tBrowse("resultsTitle")}
        </h2>
        <Results key={resultsKey} filters={filters} initial={resultsKey === initialKey ? initial : null} onReset={reset} />
      </section>
    </div>
  );
}
