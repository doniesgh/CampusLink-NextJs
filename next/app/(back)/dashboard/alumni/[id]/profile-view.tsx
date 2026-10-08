"use client";

import { ArrowLeft, Briefcase, Building2, CalendarDays, CloudOff, ExternalLink, GraduationCap, Info, MapPin, Pencil, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { AlumniAvatar } from "@/components/alumni/alumni-avatar";
import { useJobLine } from "@/components/alumni/alumni-card";
import { AlumniText } from "@/components/alumni/alumni-text";
import { AskMentoring } from "@/components/alumni/ask-mentoring";
import { MentoringBadge, VisibilityBadge } from "@/components/alumni/badges";
import { AlumniNotFound } from "@/components/alumni/not-found-state";
import { PostCard, type AlumniViewer } from "@/components/alumni/post-card";
import { useAlumniFormat, useDisplayName } from "@/components/alumni/use-alumni-format";
import Link from "@/components/ui/app-link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback } from "@/components/ui/feedback";
import { SkeletonList } from "@/components/ui/skeleton";
import { useErrorFormatter } from "@/lib/i18n/client";
import { useOfflineQuery, useOnlineStatus } from "@/lib/offline";
import { usePendingMenteeCount, type Snapshot } from "@/lib/alumni/client";
import {
  alumniHref,
  alumniPageHref,
  EMPTY_POST_FILTERS,
  myProfileHref,
  PROFILE_POSTS_LIMIT,
  postsKey,
  postsPath,
  profileKey,
  profilePath,
} from "@/lib/alumni/paths";
import { isList, isProfile, type AlumniPost, type MentoringList, type MentoringRequest, type PostList, type ProfileDetail } from "@/lib/alumni/types";

function BackLink() {
  const t = useTranslations("alumni.profile");
  return (
    <Link
      href={alumniHref}
      className="inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {t("back")}
    </Link>
  );
}

/** One fact of the profile header (`<div><dt/><dd/></div>`, icon in the term). */
function Fact({ icon: Icon, label, children }: { icon: typeof Briefcase; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-2xl bg-muted/60 px-4 py-3">
      <dt className="flex shrink-0 items-center pt-0.5 text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">{label}</span>
      </dt>
      <dd className="min-w-0 break-words text-sm text-foreground">
        <span className="block text-xs font-medium text-muted-foreground" aria-hidden="true">
          {label}
        </span>
        {children}
      </dd>
    </div>
  );
}

/** "Latest news from Selim": the alumni's 3 latest posts (read only; the wall has the actions). */
function LatestPosts({ userId, firstname, viewer, initial }: { userId: string; firstname: string; viewer: AlumniViewer; initial: Snapshot<PostList> }) {
  const t = useTranslations("alumni.profile");
  const filters = { ...EMPTY_POST_FILTERS, author: userId };
  const { data } = useOfflineQuery<PostList>(postsKey(filters, 1, PROFILE_POSTS_LIMIT), postsPath(filters, 1, PROFILE_POSTS_LIMIT), {
    fallbackData: initial?.data ?? undefined,
    fallbackSavedAt: initial?.savedAt,
    revalidateOnMount: !initial?.data,
    reportLastUpdated: false,
  });
  const posts: AlumniPost[] = isList<AlumniPost>(data) ? data.items : [];
  if (posts.length === 0) return null;
  return (
    <section aria-labelledby="profile-posts-title" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="profile-posts-title" className="text-lg font-semibold text-foreground">
          {t("posts", { name: firstname })}
        </h2>
        <Link
          href={alumniPageHref("news")}
          className="rounded-sm text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("allNews")}
        </Link>
      </div>
      <ul className="space-y-3">
        {posts.map((post) => (
          <li key={post.id}>
            <PostCard post={post} viewer={viewer} readOnly />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * /dashboard/alumni/[id]: the alumni's profile (path, about, skills linking to the directory, latest news) and the
 * "Mentoring" panel: "Ask for mentoring" for students (rules, limits, the request already sent), a short note for
 * the other roles. The owner and ADMINs also see private profiles, with a notice. Readable offline once opened.
 */
export function ProfileView({
  id,
  viewer,
  initial,
  initialRequest,
  initialPending,
  initialPosts,
}: {
  id: string;
  viewer: AlumniViewer;
  initial: Snapshot<ProfileDetail>;
  initialRequest: MentoringRequest | null;
  initialPending: Snapshot<MentoringList>;
  initialPosts: Snapshot<PostList>;
}) {
  const t = useTranslations("alumni.profile");
  const tAlumni = useTranslations("alumni");
  const tStates = useTranslations("common.states");
  const errors = useErrorFormatter();
  const online = useOnlineStatus();
  const format = useAlumniFormat();
  const displayName = useDisplayName();
  const jobLine = useJobLine();
  const { data, isLoading, error, mutate } = useOfflineQuery<ProfileDetail>(profileKey(id), profilePath(id), {
    fallbackData: initial?.data ?? undefined,
    fallbackSavedAt: initial?.savedAt,
    revalidateOnMount: !initial?.data,
  });
  const isStudent = viewer.role === "STUDENT";
  const pendingCount = usePendingMenteeCount(initialPending, isStudent);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <BackLink />
        <h1 className="sr-only">{t("loadingTitle")}</h1>
        <SkeletonList rows={4} label={tStates("loading")} />
      </div>
    );
  }

  if (!isProfile(data) || !data.id) {
    if (error?.status === 404 || error?.status === 400) {
      return <AlumniNotFound title={t("notFoundTitle")} description={t("notFoundText")} backHref={alumniHref} backLabel={t("back")} />;
    }
    const offline = !online || !!error?.isNetworkError || error?.code === "OFFLINE";
    return (
      <div className="space-y-6">
        <BackLink />
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{t("loadingTitle")}</h1>
        {offline ? (
          <EmptyState icon={CloudOff} title={t("notSavedTitle")} description={t("notSavedText")} />
        ) : (
          <InlineFeedback feedback={{ type: "error", message: error ? errors.message(error) : t("loadError") }} />
        )}
      </div>
    );
  }

  const profile = data;
  const name = displayName(profile.user);
  const firstname = profile.user.firstname || name;
  const own = profile.user.id === viewer.id;
  const isPrivate = profile.visibility !== "CAMPUS" || !profile.consentAt;
  const job = jobLine(profile);

  return (
    <div className="space-y-6">
      <BackLink />

      <section aria-labelledby="profile-name" className="rounded-3xl border bg-card p-5 text-card-foreground sm:p-6" data-profile-id={profile.id}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <AlumniAvatar user={profile.user} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 id="profile-name" className="break-words text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {name}
            </h1>
            {profile.headline && <p className="mt-1 break-words text-muted-foreground">{profile.headline}</p>}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(own || viewer.role === "ADMIN") && <VisibilityBadge visibility={isPrivate ? "PRIVATE" : "CAMPUS"} />}
              {profile.mentoringAvailable && <MentoringBadge />}
            </div>
          </div>
          {own && (
            <Button asChild variant="outline" className="shrink-0 rounded-full">
              <Link href={myProfileHref}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                {t("edit")}
              </Link>
            </Button>
          )}
        </div>

        {(own || viewer.role === "ADMIN") && isPrivate && (
          <p className="mt-4 flex items-start gap-2 rounded-2xl border border-primary/20 bg-accent px-4 py-3 text-sm text-accent-foreground" data-testid="private-notice">
            {own ? <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
            <span>{t(own ? "ownPrivate" : "adminPrivate")}</span>
          </p>
        )}

        <dl className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {job && (
            <Fact icon={Briefcase} label={t("job")}>
              {job}
            </Fact>
          )}
          {profile.program && (
            <Fact icon={GraduationCap} label={t("program")}>
              {profile.program.name} ({profile.program.code})
            </Fact>
          )}
          {profile.promotion && (
            <Fact icon={CalendarDays} label={t("promotion")}>
              {tAlumni("classOf", { year: profile.promotion })}
            </Fact>
          )}
          {profile.sector && (
            <Fact icon={Building2} label={t("sector")}>
              <Link
                href={alumniPageHref("directory", { sector: profile.sector })}
                className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {profile.sector}
              </Link>
            </Fact>
          )}
          {profile.city && (
            <Fact icon={MapPin} label={t("city")}>
              {profile.city}
            </Fact>
          )}
          {profile.linkedinUrl && (
            <Fact icon={ExternalLink} label={t("linkedin")}>
              <a
                href={profile.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="break-all rounded-sm font-semibold text-primary underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("linkedinLink")}
                <span className="sr-only"> {t("newTab")}</span>
              </a>
            </Fact>
          )}
        </dl>
        {profile.updatedAt && <p className="mt-3 text-xs text-muted-foreground">{t("updated", { date: format.date(profile.updatedAt) ?? "" })}</p>}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        {/* First in the page on phones (the action students came for), right column on large screens. */}
        <aside className="lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1">
          <section aria-labelledby="profile-mentoring-title" className="space-y-4 rounded-3xl border bg-card p-5 text-card-foreground sm:p-6">
            <h2 id="profile-mentoring-title" className="text-lg font-semibold text-foreground">
              {t("mentoringTitle")}
            </h2>
            {profile.mentoringAvailable && profile.mentoringTopics.length > 0 && (
              <div>
                <p className="text-sm text-muted-foreground">{t("topicsIntro", { name: firstname })}</p>
                <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={t("topics")}>
                  {profile.mentoringTopics.map((topic) => (
                    <li key={topic} className="rounded-full border border-success/30 bg-success/10 px-3 py-1 text-sm font-medium text-success">
                      {topic}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {isStudent ? (
              <AskMentoring
                profile={profile}
                initialRequest={initialRequest}
                pendingCount={pendingCount}
                onRequestChange={(request) =>
                  mutate((current) => (current ? { ...current, myRequest: { id: request.id, status: request.status } } : current))
                }
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {own
                  ? t(profile.mentoringAvailable ? "ownMentoringOn" : "ownMentoringOff")
                  : profile.mentoringAvailable
                    ? t("studentsOnly", { name: firstname })
                    : t("notAvailable", { name: firstname })}
              </p>
            )}
          </section>
        </aside>
        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
          <section aria-labelledby="profile-about-title" className="rounded-3xl border bg-card p-5 text-card-foreground sm:p-6">
            <h2 id="profile-about-title" className="text-lg font-semibold text-foreground">
              {t("about")}
            </h2>
            {profile.bio ? (
              <AlumniText text={profile.bio} className="mt-2 text-base leading-7" testId="profile-bio" />
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">{t("noBio", { name: firstname })}</p>
            )}
            <h2 id="profile-skills-title" className="mt-6 text-lg font-semibold text-foreground">
              {t("skills")}
            </h2>
            {profile.skills.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-1.5" aria-labelledby="profile-skills-title">
                {profile.skills.map((skill) => (
                  <li key={skill}>
                    <Link
                      href={alumniPageHref("directory", { skill })}
                      className="inline-flex rounded-full bg-muted px-3 py-1 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={t("skillLink", { skill })}
                    >
                      {skill}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">{t("noSkills")}</p>
            )}
          </section>

          <LatestPosts userId={profile.user.id} firstname={firstname} viewer={viewer} initial={initialPosts} />
        </div>

      </div>
    </div>
  );
}
