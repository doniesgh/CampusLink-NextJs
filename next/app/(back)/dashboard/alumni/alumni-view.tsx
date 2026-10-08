"use client";

import { useEffect, useMemo, useRef } from "react";
import { Handshake, LifeBuoy, Newspaper, UserRound, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Directory } from "@/components/alumni/directory";
import { MentoringList } from "@/components/alumni/mentoring-list";
import { MentoringRules } from "@/components/alumni/mentoring-rules";
import { NewsWall } from "@/components/alumni/news-wall";
import type { AlumniViewer } from "@/components/alumni/post-card";
import { SupportList } from "@/components/alumni/support-list";
import Link from "@/components/ui/app-link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { replaceSearch, useFacets, useLocationHash, useLocationSearch, type Snapshot } from "@/lib/alumni/client";
import { alumniSearch, parseDirectoryFilters, parseTab, tabsFor, type AlumniTab, type DirectoryFilters } from "@/lib/alumni/filters";
import { MENTORING_ANCHOR, myProfileHref } from "@/lib/alumni/paths";
import type { DirectoryList, Facets, MentoringList as MentoringListData, PostList } from "@/lib/alumni/types";

export type AlumniInitial = {
  directory: Snapshot<DirectoryList>;
  /** filtersKey() of the filters the server rendered the directory for. */
  directoryKey: string;
  facets: Snapshot<Facets>;
  posts: Snapshot<PostList>;
  /** Students only: first page of their active requests. */
  mentoring: Snapshot<MentoringListData>;
};

const TAB_ICONS = { directory: Users, news: Newspaper, mentoring: Handshake, support: LifeBuoy } as const;

/**
 * /dashboard/alumni: tabs "Directory" (search and filters), "News" (the wall), "My mentoring" (students: the requests
 * they sent; notification links "#mentoring" open it) and "All profiles" (ADMIN support). The tab and the directory
 * filters live in the address (`?tab&q&program&promotion&sector&skill&mentoring&sort`), replaced without a server
 * round trip.
 */
export function AlumniView({ viewer, serverSearch, initial }: { viewer: AlumniViewer; serverSearch: string; initial: AlumniInitial }) {
  const t = useTranslations("alumni");
  const tTabs = useTranslations("alumni.tabs");
  const search = useLocationSearch(serverSearch);
  const hash = useLocationHash();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const tab = parseTab(params, viewer.role, hash);
  const filters = useMemo(() => parseDirectoryFilters(params), [params]);
  const facets = useFacets(initial.facets);
  const tabs = tabsFor(viewer.role);

  const navigate = (nextTab: AlumniTab, nextFilters: DirectoryFilters) => replaceSearch(alumniSearch(nextTab, nextFilters));

  // Notification links ("/dashboard/alumni#mentoring") open the student's requests: bring them into view once.
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || hash !== `#${MENTORING_ANCHOR}` || tab !== "mentoring") return;
    const element = document.getElementById(MENTORING_ANCHOR);
    if (!element) return;
    scrolled.current = true;
    element.scrollIntoView({ block: "start" });
  }, [hash, tab]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          viewer.role === "ALUMNI" ? (
            <Button asChild variant="outline" className="rounded-full">
              <Link href={myProfileHref}>
                <UserRound className="h-4 w-4" aria-hidden="true" />
                {t("myProfileLink")}
              </Link>
            </Button>
          ) : null
        }
      />

      <Tabs value={tab} onValueChange={(value) => navigate(value as AlumniTab, filters)}>
        <TabsList aria-label={tTabs("label")} className="flex w-full sm:inline-flex sm:w-auto">
          {tabs.map((entry) => {
            const Icon = TAB_ICONS[entry];
            return (
              <TabsTrigger key={entry} value={entry} className="flex-1 px-3 sm:flex-none sm:px-4" data-tab={entry}>
                <Icon className="hidden h-4 w-4 sm:block" aria-hidden="true" />
                {tTabs(entry)}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value="directory">
          <Directory
            filters={filters}
            onChange={(next) => navigate("directory", next)}
            initial={initial.directory}
            initialKey={initial.directoryKey}
            facets={facets}
          />
        </TabsContent>

        <TabsContent value="news">
          <div className="max-w-3xl">
            <NewsWall mode="wall" viewer={viewer} initial={initial.posts} headingId="alumni-news-title" />
          </div>
        </TabsContent>

        {tabs.includes("mentoring") && (
          <TabsContent value="mentoring">
            <section id={MENTORING_ANCHOR} aria-labelledby="alumni-mentoring-title" className="max-w-3xl scroll-mt-6 space-y-4">
              <div>
                <h2 id="alumni-mentoring-title" className="text-lg font-semibold text-foreground">
                  {t("mentoring.menteeTitle")}
                </h2>
                <p className="text-sm text-muted-foreground">{t("mentoring.menteeIntro")}</p>
              </div>
              <MentoringRules />
              <MentoringList
                role="mentee"
                initial={initial.mentoring}
                emptyAction={
                  <Button type="button" variant="outline" className="rounded-full" onClick={() => navigate("directory", { ...filters, mentoring: true })}>
                    <Users className="h-4 w-4" aria-hidden="true" />
                    {t("mentoring.findMentor")}
                  </Button>
                }
              />
            </section>
          </TabsContent>
        )}

        {tabs.includes("support") && (
          <TabsContent value="support">
            <SupportList />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
