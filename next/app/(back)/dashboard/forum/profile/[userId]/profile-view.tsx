import { ArrowLeft, Award, BadgeCheck, MessageCircleQuestion, MessageSquare, Sparkles, Star } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useForumAuthorName } from "@/components/forum/author-link";
import { SubjectBadge } from "@/components/forum/badges";
import Link from "@/components/ui/app-link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { forumHref } from "@/lib/forum/paths";
import { BADGE_CODES, type BadgeCode, type ForumBadge, type ForumProfile } from "@/lib/forum/types";
import { cn } from "@/lib/utils";

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

const isKnownBadge = (code: string): code is BadgeCode => (BADGE_CODES as readonly string[]).includes(code);

/** One badge: label ("Expert in Databases"), what it rewards, when it was earned. */
function BadgeItem({ badge }: { badge: ForumBadge }) {
  const t = useTranslations("forum.badges");
  const tProfile = useTranslations("forum.profile");
  const format = useFormatter();
  const subject = badge.subject?.name ?? badge.subject?.code ?? "";
  const code = isKnownBadge(badge.code) ? badge.code : "unknown";
  const awardedAt = new Date(badge.awardedAt);
  return (
    <li className="flex items-start gap-3 rounded-2xl border bg-background p-4" data-badge-code={badge.code}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-highlight/20 text-foreground">
        <Award className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="font-semibold text-foreground">{t(`${code}.label`, { subject })}</p>
        <p className="text-sm text-muted-foreground">{t(`${code}.text`, { subject })}</p>
        {!Number.isNaN(awardedAt.getTime()) && (
          <p className="mt-1 text-xs text-muted-foreground">
            {tProfile("awardedOn", { date: format.dateTime(awardedAt, "date") })}
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * /dashboard/forum/profile/[userId] (Server Component): reputation (all time and this academic year),
 * questions / answers / accepted answers, badges, and answers and points by subject.
 */
export function ProfileView({ profile, isSelf }: { profile: ForumProfile; isSelf: boolean }) {
  const t = useTranslations("forum.profile");
  const tRoles = useTranslations("common.roles");
  const format = useFormatter();
  const name = useForumAuthorName()(profile.user);
  const subjects = Array.isArray(profile.subjects) ? profile.subjects : [];
  const badges = Array.isArray(profile.badges) ? profile.badges : [];
  const maxPoints = Math.max(1, ...subjects.map((entry) => entry.points));

  const stats = [
    { key: "reputation", label: t("reputation"), value: profile.reputation, icon: Star },
    { key: "season", label: t("season", { year: profile.season?.academicYear ?? "" }), value: profile.season?.reputation ?? 0, icon: Sparkles },
    { key: "questions", label: t("questions"), value: profile.questions ?? 0, icon: MessageCircleQuestion },
    { key: "answers", label: t("answers"), value: profile.answers ?? 0, icon: MessageSquare },
    { key: "accepted", label: t("accepted"), value: profile.acceptedAnswers ?? 0, icon: BadgeCheck },
  ];

  return (
    <div className="space-y-8">
      <Link
        href={forumHref}
        className="inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("back")}
      </Link>

      <header className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary text-xl font-bold text-primary-foreground"
        >
          {initialsOf(name)}
        </span>
        <div className="min-w-0 space-y-1.5">
          <h1 className="break-words text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {profile.user.role && (
              <Badge variant="secondary" data-role={profile.user.role}>
                {tRoles(profile.user.role)}
              </Badge>
            )}
            {isSelf && <Badge variant="highlight">{t("you")}</Badge>}
          </div>
        </div>
      </header>

      <section aria-labelledby="profile-stats-title" className="space-y-3">
        <h2 id="profile-stats-title" className="sr-only">
          {t("statsLabel")}
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {stats.map(({ key, label, value, icon: Icon }, index) => (
            <div key={key} className={cn("rounded-2xl border bg-card p-4 text-card-foreground", index === 0 && "col-span-2 sm:col-span-1")} data-stat={key}>
              <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {label}
              </dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums text-foreground">{format.number(value)}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-muted-foreground">{t("pointsHint")}</p>
      </section>

      <section aria-labelledby="profile-badges-title" className="space-y-3">
        <h2 id="profile-badges-title" className="text-xl font-semibold tracking-tight text-foreground">
          {t("badgesTitle")}
        </h2>
        {badges.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noBadges")}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {badges.map((badge) => (
              <BadgeItem key={`${badge.code}-${badge.subject?.id ?? ""}`} badge={badge} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="profile-subjects-title" className="space-y-3">
        <h2 id="profile-subjects-title" className="text-xl font-semibold tracking-tight text-foreground">
          {t("subjectsTitle")}
        </h2>
        {subjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noSubjects")}</p>
        ) : (
          <Table aria-labelledby="profile-subjects-title">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t("subjectColumn")}</TableHead>
                <TableHead scope="col" className="text-right">
                  {t("answersColumn")}
                </TableHead>
                <TableHead scope="col" className="text-right sm:w-2/5">
                  {t("pointsColumn")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subjects.map((entry) => (
                <TableRow key={entry.subject.id} data-subject-id={entry.subject.id}>
                  <TableCell>
                    <SubjectBadge subject={entry.subject} wrap />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{format.number(entry.answers)}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <span className="hidden h-2 flex-1 overflow-hidden rounded-full bg-muted sm:block" aria-hidden="true">
                        <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round((entry.points / maxPoints) * 100)}%` }} />
                      </span>
                      <span className="w-12 text-right font-semibold tabular-nums">{format.number(entry.points)}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
