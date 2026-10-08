"use client";

import { useState } from "react";
import { CloudOff, RotateCw, Search, SearchX, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { AlumniAvatar } from "@/components/alumni/alumni-avatar";
import { MentoringBadge, VisibilityBadge } from "@/components/alumni/badges";
import { useAlumniFormat, useDisplayName } from "@/components/alumni/use-alumni-format";
import Link from "@/components/ui/app-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SkeletonList } from "@/components/ui/skeleton";
import { useErrorFormatter } from "@/lib/i18n/client";
import { useOnlineStatus } from "@/lib/offline";
import { useLiveQuery } from "@/lib/alumni/client";
import { EMPTY_SUPPORT_FILTERS, profileHref, SUPPORT_PAGE_SIZE, supportPath, type SupportFilters } from "@/lib/alumni/paths";
import { isList, SEARCH_MAX_LENGTH, type AdminProfile, type AdminProfileList, type Visibility } from "@/lib/alumni/types";

function Row({ profile }: { profile: AdminProfile }) {
  const t = useTranslations("alumni.support");
  const format = useAlumniFormat();
  const name = useDisplayName()(profile.user);
  return (
    <article
      className="relative flex flex-col gap-3 rounded-2xl border bg-card p-4 text-card-foreground focus-within:ring-2 focus-within:ring-ring hover:bg-accent/50 sm:flex-row sm:items-center"
      data-profile-id={profile.id}
      data-listed={profile.listed ? "true" : "false"}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <AlumniAvatar user={profile.user} size="sm" />
        <div className="min-w-0">
          <h3 className="break-words text-sm font-semibold text-foreground">
            <Link href={profileHref(profile.id)} className="rounded-sm after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none">
              {name}
            </Link>
          </h3>
          {profile.headline && <p className="line-clamp-1 break-words text-sm text-muted-foreground">{profile.headline}</p>}
          <p className="text-xs text-muted-foreground">
            {profile.updatedAt ? t("updated", { date: format.date(profile.updatedAt) ?? "" }) : t("neverUpdated")}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 sm:justify-end">
        <VisibilityBadge visibility={profile.visibility} />
        <Badge variant={profile.listed ? "secondary" : "outline"} data-badge="listed">
          {t(profile.listed ? "listed" : "notListed")}
        </Badge>
        {profile.mentoringAvailable && <MentoringBadge />}
      </div>
    </article>
  );
}

function NextPage({ filters, page }: { filters: SupportFilters; page: number }) {
  const t = useTranslations("alumni.support");
  const tStates = useTranslations("common.states");
  const { data, isLoading } = useLiveQuery<AdminProfileList>(supportPath(filters, page));
  if (isLoading) {
    return (
      <li>
        <SkeletonList rows={2} label={tStates("loading")} />
      </li>
    );
  }
  if (!isList<AdminProfile>(data)) return <li className="px-1 text-sm text-muted-foreground">{t("pageError")}</li>;
  return (
    <>
      {data.items.map((profile) => (
        <li key={profile.id}>
          <Row profile={profile} />
        </li>
      ))}
    </>
  );
}

function Results({ filters, onReset }: { filters: SupportFilters; onReset: () => void }) {
  const t = useTranslations("alumni.support");
  const tStates = useTranslations("common.states");
  const tActions = useTranslations("common.actions");
  const errors = useErrorFormatter();
  const online = useOnlineStatus();
  const [pages, setPages] = useState(1);
  const first = useLiveQuery<AdminProfileList>(supportPath(filters, 1));
  const filtered = !!(filters.q || filters.visibility || filters.mentoring);

  if (first.isLoading) return <SkeletonList rows={3} label={tStates("loading")} />;
  const list = first.data;
  if (!isList<AdminProfile>(list)) {
    const offline = !online || !!first.error?.isNetworkError || first.error?.code === "OFFLINE";
    if (offline) return <EmptyState icon={CloudOff} title={t("notSavedTitle")} description={t("notSavedText")} headingLevel="h3" />;
    return (
      <InlineFeedback feedback={{ type: "error", message: first.error ? `${t("loadError")} ${errors.message(first.error)}` : t("loadError") }}>
        <Button variant="outline" size="sm" className="mt-2 rounded-full" onClick={first.refresh}>
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          {tActions("tryAgain")}
        </Button>
      </InlineFeedback>
    );
  }
  if (list.items.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title={t(filtered ? "noResults" : "empty")}
        headingLevel="h3"
        action={
          filtered ? (
            <Button variant="outline" className="rounded-full" onClick={onReset}>
              <X className="h-4 w-4" aria-hidden="true" />
              {tActions("resetFilters")}
            </Button>
          ) : undefined
        }
      />
    );
  }
  const total = typeof list.total === "number" ? list.total : list.items.length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground" data-testid="support-count">
        {t("count", { count: total })}
      </p>
      <ul className="space-y-2">
        {list.items.map((profile) => (
          <li key={profile.id}>
            <Row profile={profile} />
          </li>
        ))}
        {Array.from({ length: pages - 1 }, (_, index) => (
          <NextPage key={index + 2} filters={filters} page={index + 2} />
        ))}
      </ul>
      {total > pages * SUPPORT_PAGE_SIZE && (
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
 * ADMIN support list: every alumni profile, PRIVATE ones included (GET /api/alumni/admin/profiles), with "Search",
 * "Visibility" and "Mentoring" filters. Each profile opens its page (admins see private profiles there). Read online
 * only: this list is never saved on the device.
 */
export function SupportList() {
  const t = useTranslations("alumni.support");
  const tActions = useTranslations("common.actions");
  const [filters, setFilters] = useState<SupportFilters>(EMPTY_SUPPORT_FILTERS);
  const filtered = !!(filters.q || filters.visibility || filters.mentoring);
  const reset = () => setFilters(EMPTY_SUPPORT_FILTERS);

  return (
    <section aria-labelledby="alumni-support-title" className="space-y-4">
      <div>
        <h2 id="alumni-support-title" className="text-lg font-semibold text-foreground">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>
      <div className="space-y-3 rounded-3xl border bg-card p-4 text-card-foreground sm:p-5">
        <form
          role="search"
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get("q");
            setFilters({ ...filters, q: typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "" });
          }}
        >
          <label htmlFor="alumni-support-search" className="sr-only">
            {t("search")}
          </label>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              key={filters.q}
              id="alumni-support-search"
              name="q"
              type="search"
              defaultValue={filters.q}
              maxLength={SEARCH_MAX_LENGTH}
              placeholder={t("searchPlaceholder")}
              className="pl-9"
            />
          </div>
          <Button type="submit" className="shrink-0">
            {t("searchButton")}
          </Button>
        </form>
        <div className="flex flex-wrap items-end gap-3">
          <Field id="alumni-support-visibility" label={t("visibility")} className="min-w-44 flex-1 sm:flex-none">
            {(props) => (
              <Select
                {...props}
                value={filters.visibility}
                onChange={(event) => setFilters({ ...filters, visibility: event.target.value as Visibility | "" })}
              >
                <option value="">{t("allVisibilities")}</option>
                <option value="CAMPUS">{t("campus")}</option>
                <option value="PRIVATE">{t("private")}</option>
              </Select>
            )}
          </Field>
          <Field id="alumni-support-mentoring" label={t("mentoring")} className="min-w-44 flex-1 sm:flex-none">
            {(props) => (
              <Select
                {...props}
                value={filters.mentoring}
                onChange={(event) => setFilters({ ...filters, mentoring: event.target.value as SupportFilters["mentoring"] })}
              >
                <option value="">{t("mentoringAll")}</option>
                <option value="true">{t("mentoringYes")}</option>
                <option value="false">{t("mentoringNo")}</option>
              </Select>
            )}
          </Field>
          {filtered && (
            <Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={reset}>
              <X className="h-4 w-4" aria-hidden="true" />
              {tActions("resetFilters")}
            </Button>
          )}
        </div>
      </div>
      <Results key={supportPath(filters, 1)} filters={filters} onReset={reset} />
    </section>
  );
}
