"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CloudOff, Database, Eye, Handshake, Info, Newspaper, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { MentoringList } from "@/components/alumni/mentoring-list";
import { MyData } from "@/components/alumni/my-data";
import { NewsWall } from "@/components/alumni/news-wall";
import type { AlumniViewer } from "@/components/alumni/post-card";
import { ProfileForm } from "@/components/alumni/profile-form";
import { VisibilityCard } from "@/components/alumni/visibility-card";
import Link from "@/components/ui/app-link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback, type Feedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonList } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useErrorFormatter } from "@/lib/i18n/client";
import { invalidateQueries, useOfflineQuery, useOnlineStatus } from "@/lib/offline";
import { replaceSearch, seed, useFacets, useLocationHash, useLocationSearch, usePrograms, type Snapshot } from "@/lib/alumni/client";
import { parseMeTab, ME_TABS, type MeTab } from "@/lib/alumni/filters";
import { MENTORING_ANCHOR, mentoringKey, mentoringPath, MY_PROFILE_KEY, MY_PROFILE_PATH, profileHref } from "@/lib/alumni/paths";
import { emptyProfile, isProfile, type AlumniProfile, type Facets, type MentoringList as MentoringListData, type PostList } from "@/lib/alumni/types";
import type { Program } from "@/lib/types";

export type MyProfileInitial = {
  profile: Snapshot<AlumniProfile>;
  programs: Snapshot<Program[]>;
  facets: Snapshot<Facets>;
  mentoring: Snapshot<MentoringListData>;
  posts: Snapshot<PostList>;
};

const TAB_ICONS = { profile: UserRound, mentoring: Handshake, posts: Newspaper, data: Database } as const;
type Anchored = { anchor: "visibility" | "form"; value: Feedback } | null;

/**
 * /dashboard/alumni/me (ALUMNI): tabs "Profile" (visibility and consent, then the profile form), "Mentoring" (requests
 * received, `#mentoring` from notification links), "My posts" and "My data" (export, erasure). The tab lives in the
 * address (`?tab=`), replaced without a server round trip.
 */
export function MyProfileView({ viewer, serverSearch, initial }: { viewer: AlumniViewer; serverSearch: string; initial: MyProfileInitial }) {
  const t = useTranslations("alumni.me");
  const tAlumni = useTranslations("alumni");
  const tStates = useTranslations("common.states");
  const errors = useErrorFormatter();
  const online = useOnlineStatus();
  const search = useLocationSearch(serverSearch);
  const hash = useLocationHash();
  const tab = parseMeTab(useMemo(() => new URLSearchParams(search), [search]), hash);
  const { data, isLoading, error, mutate, refresh } = useOfflineQuery<AlumniProfile>(MY_PROFILE_KEY, MY_PROFILE_PATH, seed(initial.profile));
  const programs = usePrograms(initial.programs);
  const facets = useFacets(initial.facets);
  // Same query as the first page of the list in the "Mentoring" tab: its pending count is the tab's badge.
  const mentoring = useOfflineQuery<MentoringListData>(mentoringKey("mentor", "active", 1), mentoringPath("mentor", "active", 1), {
    ...seed(initial.mentoring),
    reportLastUpdated: false,
  });
  const pendingCount = typeof mentoring.data?.pendingCount === "number" ? mentoring.data.pendingCount : 0;
  const [profileFeedback, setProfileFeedback] = useState<Anchored>(null);
  const [dataFeedback, setDataFeedback] = useState<Feedback | null>(null);
  const [formVersion, setFormVersion] = useState(0);

  // Notification links ("/dashboard/alumni/me#mentoring") open the requests received: bring them into view once.
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || hash !== `#${MENTORING_ANCHOR}` || tab !== "mentoring") return;
    const element = document.getElementById(MENTORING_ANCHOR);
    if (!element) return;
    scrolled.current = true;
    element.scrollIntoView({ block: "start" });
  }, [hash, tab]);

  const selectTab = (next: MeTab) => replaceSearch(next === "profile" ? "" : `tab=${next}`);
  const anchored = (anchor: "visibility" | "form") => (value: Feedback) => setProfileFeedback({ anchor, value: { ...value, at: Date.now() } });
  const profile = isProfile(data) ? data : null;

  const header = (
    <PageHeader
      title={tAlumni("meTitle")}
      description={tAlumni("meDescription")}
      actions={
        profile?.id ? (
          <Button asChild variant="outline" className="rounded-full">
            <Link href={profileHref(profile.id)}>
              <Eye className="h-4 w-4" aria-hidden="true" />
              {t("viewProfile")}
            </Link>
          </Button>
        ) : null
      }
    />
  );

  if (!profile) {
    const offline = !online || !!error?.isNetworkError || error?.code === "OFFLINE";
    return (
      <div className="space-y-6">
        {header}
        {isLoading ? (
          <SkeletonList rows={4} label={tStates("loading")} />
        ) : offline ? (
          <EmptyState icon={CloudOff} title={t("notSavedTitle")} description={t("notSavedText")} />
        ) : (
          <InlineFeedback feedback={{ type: "error", message: error ? errors.message(error) : t("loadError") }} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <Tabs value={tab} onValueChange={(value) => selectTab(value as MeTab)}>
        <TabsList aria-label={t("tabsLabel")} className="flex w-full sm:inline-flex sm:w-auto">
          {ME_TABS.map((entry) => {
            const Icon = TAB_ICONS[entry];
            return (
              <TabsTrigger key={entry} value={entry} className="flex-1 gap-1.5 px-2 sm:flex-none sm:px-4" data-tab={entry}>
                <Icon className="hidden h-4 w-4 sm:block" aria-hidden="true" />
                {t(`tabs.${entry}`)}
                {entry === "mentoring" && pendingCount > 0 && (
                  <span
                    className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-highlight px-1.5 text-xs font-semibold text-highlight-foreground"
                    data-testid="pending-badge"
                  >
                    {pendingCount}
                    <span className="sr-only"> {t("pendingBadge", { count: pendingCount })}</span>
                  </span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value="profile" className="space-y-5">
          <VisibilityCard
            profile={profile}
            onChanged={(next) => mutate(next)}
            feedback={profileFeedback?.anchor === "visibility" ? profileFeedback.value : null}
            report={anchored("visibility")}
          />
          <ProfileForm
            key={formVersion}
            profile={profile}
            programs={programs}
            sectorSuggestions={(facets?.sectors ?? []).map((entry) => entry.value)}
            skillSuggestions={(facets?.skills ?? []).map((entry) => entry.value)}
            onSaved={(next, message) => {
              mutate(next);
              anchored("form")({ type: "success", message });
              invalidateQueries("alumni:facets");
            }}
            onFailure={(message) => anchored("form")({ type: "error", message })}
            feedbackSlot={<InlineFeedback feedback={profileFeedback?.anchor === "form" ? profileFeedback.value : null} />}
          />
        </TabsContent>

        <TabsContent value="mentoring">
          <section id={MENTORING_ANCHOR} aria-labelledby="alumni-received-title" className="scroll-mt-6 space-y-4">
            <div>
              <h2 id="alumni-received-title" className="text-lg font-semibold text-foreground">
                {t("mentoringTitle")}
              </h2>
              <p className="text-sm text-muted-foreground">{t("mentoringIntro")}</p>
            </div>
            {!profile.mentoringAvailable && (
              <p className="flex items-start gap-2 rounded-2xl border border-primary/20 bg-accent px-4 py-3 text-sm text-accent-foreground" data-testid="mentoring-off">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{t("mentoringOff")}</span>
              </p>
            )}
            <MentoringList role="mentor" initial={initial.mentoring} />
          </section>
        </TabsContent>

        <TabsContent value="posts">
          <NewsWall mode="mine" viewer={viewer} initial={initial.posts} headingId="alumni-my-posts-title" />
        </TabsContent>

        <TabsContent value="data">
          <MyData
            feedback={dataFeedback}
            report={(value) => setDataFeedback({ ...value, at: Date.now() })}
            onErased={(message) => {
              setDataFeedback({ type: "success", message, at: Date.now() });
              setProfileFeedback(null);
              // The form starts again from an empty profile; the server's answer follows.
              mutate(emptyProfile(profile.user));
              setFormVersion((version) => version + 1);
              void refresh();
              invalidateQueries("alumni");
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
