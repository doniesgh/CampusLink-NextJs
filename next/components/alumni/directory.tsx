"use client";

import { useState } from "react";
import { CloudOff, RotateCw, Search, SearchX, Users, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { AlumniCard } from "@/components/alumni/alumni-card";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SkeletonList } from "@/components/ui/skeleton";
import { useErrorFormatter } from "@/lib/i18n/client";
import { useOfflineQuery, useOnlineStatus } from "@/lib/offline";
import type { Snapshot } from "@/lib/alumni/client";
import {
  DIRECTORY_SORTS,
  EMPTY_DIRECTORY_FILTERS,
  filtersKey,
  isDirectoryFiltered,
  type DirectoryFilters,
  type DirectorySort,
} from "@/lib/alumni/filters";
import { DIRECTORY_PAGE_SIZE, directoryKey, directoryPath } from "@/lib/alumni/paths";
import { isList, SEARCH_MAX_LENGTH, type AlumniProfile, type DirectoryList, type Facets } from "@/lib/alumni/types";

type Listed = AlumniProfile & { id: string };
const listed = (items: AlumniProfile[]) => items.filter((profile): profile is Listed => typeof profile.id === "string");

/** Pages 2..n of the directory ("Load more"), each its own offline query. */
function NextPage({ filters, page }: { filters: DirectoryFilters; page: number }) {
  const t = useTranslations("alumni.directory");
  const tStates = useTranslations("common.states");
  const { data, isLoading } = useOfflineQuery<DirectoryList>(directoryKey(filters, page), directoryPath(filters, page));
  if (isLoading) {
    return (
      <li className="sm:col-span-2 xl:col-span-3">
        <SkeletonList rows={2} label={tStates("loading")} />
      </li>
    );
  }
  if (!isList<AlumniProfile>(data)) return <li className="px-1 text-sm text-muted-foreground sm:col-span-2 xl:col-span-3">{t("pageError")}</li>;
  return (
    <>
      {listed(data.items).map((profile) => (
        <li key={profile.id}>
          <AlumniCard profile={profile} activeSkill={filters.skill} />
        </li>
      ))}
    </>
  );
}

/** The alumni matching the filters: first page from the server, "Load more", offline states. */
function Results({ filters, initial, onReset }: { filters: DirectoryFilters; initial: Snapshot<DirectoryList>; onReset: () => void }) {
  const t = useTranslations("alumni.directory");
  const tStates = useTranslations("common.states");
  const tActions = useTranslations("common.actions");
  const errors = useErrorFormatter();
  const online = useOnlineStatus();
  const [pages, setPages] = useState(1);
  const first = useOfflineQuery<DirectoryList>(directoryKey(filters, 1), directoryPath(filters, 1), {
    fallbackData: initial?.data ?? undefined,
    fallbackSavedAt: initial?.savedAt,
    revalidateOnMount: !initial?.data,
  });

  if (first.isLoading) return <SkeletonList rows={4} label={tStates("loading")} />;

  const list = first.data;
  if (!isList<AlumniProfile>(list)) {
    const offline = !online || !!first.error?.isNetworkError || first.error?.code === "OFFLINE";
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

  const items = listed(list.items);
  const total = typeof list.total === "number" ? list.total : items.length;
  if (items.length === 0) {
    return isDirectoryFiltered(filters) ? (
      <EmptyState
        icon={SearchX}
        title={t("noResults")}
        description={t("noResultsText")}
        action={
          <Button variant="outline" className="rounded-full" onClick={onReset}>
            <X className="h-4 w-4" aria-hidden="true" />
            {tActions("resetFilters")}
          </Button>
        }
      />
    ) : (
      <EmptyState icon={Users} title={t("empty")} description={t("emptyText")} />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground" data-testid="alumni-count" aria-live="polite">
        {t("count", { count: total })}
      </p>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((profile) => (
          <li key={profile.id}>
            <AlumniCard profile={profile} activeSkill={filters.skill} />
          </li>
        ))}
        {Array.from({ length: pages - 1 }, (_, index) => (
          <NextPage key={index + 2} filters={filters} page={index + 2} />
        ))}
      </ul>
      {total > pages * DIRECTORY_PAGE_SIZE && (
        <div className="flex justify-center">
          <Button variant="outline" className="rounded-full" onClick={() => setPages((count) => count + 1)}>
            {tActions("loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Options of a facet filter, keeping the value of the address even when it is no longer offered. */
function withCurrent<T extends { value: string; label: string }>(options: T[], current: string, make: (value: string) => T): T[] {
  if (!current || options.some((option) => option.value.toLowerCase() === current.toLowerCase())) return options;
  return [make(current), ...options];
}

/**
 * Directory tab: search ("Search"), filters "Program", "Graduation year", "Sector", "Skill", "Sort by" and
 * "Mentoring available only", then the alumni cards. Filters live in the address (`filters` / `onChange`).
 */
export function Directory({
  filters,
  onChange,
  initial,
  initialKey,
  facets,
}: {
  filters: DirectoryFilters;
  onChange: (filters: DirectoryFilters) => void;
  /** First page rendered by the server, for the filters of `initialKey`. */
  initial: Snapshot<DirectoryList>;
  initialKey: string;
  facets: Facets | null;
}) {
  const t = useTranslations("alumni.directory");
  const tActions = useTranslations("common.actions");
  const key = filtersKey(filters);
  const apply = (patch: Partial<DirectoryFilters>) => onChange({ ...filters, ...patch });
  const reset = () => onChange({ ...EMPTY_DIRECTORY_FILTERS, sort: filters.sort });

  const option = (label: string, count: number) => t("optionCount", { label, count });
  const programs = withCurrent(
    (facets?.programs ?? []).map((program) => ({ value: program.id, label: option(program.name, program.count) })),
    filters.program,
    (value) => ({ value, label: t("unknownProgram") })
  );
  const promotions = withCurrent(
    (facets?.promotions ?? []).map((promotion) => ({ value: String(promotion.value), label: option(String(promotion.value), promotion.count) })),
    filters.promotion,
    (value) => ({ value, label: value })
  );
  const sectors = withCurrent(
    (facets?.sectors ?? []).map((sector) => ({ value: sector.value, label: option(sector.value, sector.count) })),
    filters.sector,
    (value) => ({ value, label: value })
  );
  const skills = withCurrent(
    (facets?.skills ?? []).map((skill) => ({ value: skill.value, label: option(skill.value, skill.count) })),
    filters.skill,
    (value) => ({ value, label: value })
  );
  const matchValue = (options: { value: string }[], current: string) =>
    options.find((entry) => entry.value.toLowerCase() === current.toLowerCase())?.value ?? current;

  return (
    <div className="space-y-5">
      <section aria-labelledby="alumni-filters-title" className="space-y-4 rounded-3xl border bg-card p-4 text-card-foreground sm:p-5">
        <h2 id="alumni-filters-title" className="sr-only">
          {t("filtersTitle")}
        </h2>
        <form
          role="search"
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get("q");
            apply({ q: typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "" });
          }}
        >
          <label htmlFor="alumni-search" className="sr-only">
            {t("search")}
          </label>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              // A reset or another link puts the address's text back in the field.
              key={filters.q}
              id="alumni-search"
              name="q"
              type="search"
              defaultValue={filters.q}
              placeholder={t("searchPlaceholder")}
              maxLength={SEARCH_MAX_LENGTH}
              className="pl-9"
            />
          </div>
          <Button type="submit" className="shrink-0">
            {t("searchButton")}
          </Button>
        </form>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Field id="alumni-program" label={t("program")} className="col-span-2 sm:col-span-1">
            {(props) => (
              <Select {...props} value={filters.program} onChange={(event) => apply({ program: event.target.value })}>
                <option value="">{t("allPrograms")}</option>
                {programs.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="alumni-promotion" label={t("promotion")}>
            {(props) => (
              <Select {...props} value={filters.promotion} onChange={(event) => apply({ promotion: event.target.value })}>
                <option value="">{t("allPromotions")}</option>
                {promotions.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="alumni-sector" label={t("sector")}>
            {(props) => (
              <Select {...props} value={matchValue(sectors, filters.sector)} onChange={(event) => apply({ sector: event.target.value })}>
                <option value="">{t("allSectors")}</option>
                {sectors.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="alumni-skill" label={t("skill")}>
            {(props) => (
              <Select {...props} value={matchValue(skills, filters.skill)} onChange={(event) => apply({ skill: event.target.value })}>
                <option value="">{t("allSkills")}</option>
                {skills.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="alumni-sort" label={t("sort")}>
            {(props) => (
              <Select {...props} value={filters.sort} onChange={(event) => apply({ sort: event.target.value as DirectorySort })}>
                {DIRECTORY_SORTS.map((sort) => (
                  <option key={sort} value={sort}>
                    {t(`sorts.${sort}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <CheckboxField
            id="alumni-mentoring"
            label={t("mentoringOnly")}
            description={facets ? t("mentoringCount", { count: facets.mentoringAvailable }) : undefined}
            checked={filters.mentoring}
            onChange={(event) => apply({ mentoring: event.target.checked })}
          />
          {isDirectoryFiltered(filters) && (
            <Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={reset}>
              <X className="h-4 w-4" aria-hidden="true" />
              {tActions("resetFilters")}
            </Button>
          )}
        </div>
      </section>

      <section aria-labelledby="alumni-results-title" className="min-w-0">
        <h2 id="alumni-results-title" className="sr-only">
          {t("resultsTitle")}
        </h2>
        <Results key={key} filters={filters} initial={key === initialKey ? initial : null} onReset={reset} />
      </section>
    </div>
  );
}
