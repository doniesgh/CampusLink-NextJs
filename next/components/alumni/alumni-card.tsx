"use client";

import { Briefcase, GraduationCap, MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { AlumniAvatar } from "@/components/alumni/alumni-avatar";
import { MentoringBadge } from "@/components/alumni/badges";
import { useDisplayName } from "@/components/alumni/use-alumni-format";
import Link from "@/components/ui/app-link";
import { profileHref } from "@/lib/alumni/paths";
import type { AlumniProfile } from "@/lib/alumni/types";

const VISIBLE_SKILLS = 4;

/** "Lead dev chez X" and "Lead dev at X" say the same thing: compare without the joining word. */
function sameText(a: string, b: string): boolean {
  const words = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((word) => word && !["at", "chez", "a", "@"].includes(word))
      .join(" ");
  return words(a) === words(b);
}

/** "Lead developer at Medina Soft", "Medina Soft" or "Lead developer" (null when neither is known). */
export function useJobLine(): (profile: Pick<AlumniProfile, "jobTitle" | "company">) => string | null {
  const t = useTranslations("alumni.card");
  return ({ jobTitle, company }) => {
    if (jobTitle && company) return t("jobAt", { jobTitle, company });
    return jobTitle || company || null;
  };
}

/**
 * One alumni of the directory: an <article> whose name (h3) links to the profile (the whole card is clickable),
 * with the headline, job, program and graduation year, city, the first skills and "Open to mentoring".
 */
export function AlumniCard({ profile, activeSkill }: { profile: AlumniProfile & { id: string }; activeSkill?: string }) {
  const t = useTranslations("alumni.card");
  const tAlumni = useTranslations("alumni");
  const name = useDisplayName()(profile.user);
  const job = useJobLine()(profile);
  // The headline usually says the job already: the job line is listed only when it says something else.
  const subtitle = profile.headline || job;
  const showJob = !!job && !!profile.headline && !sameText(profile.headline, job);
  const extraSkills = Math.max(0, profile.skills.length - VISIBLE_SKILLS);
  const school = [profile.program?.code ?? profile.program?.name, profile.promotion ? tAlumni("classOf", { year: profile.promotion }) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <article
      className="group relative flex h-full flex-col rounded-2xl border bg-card p-4 text-card-foreground transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-accent/50 sm:p-5"
      data-alumni-id={profile.id}
      data-mentoring={profile.mentoringAvailable ? "true" : "false"}
    >
      <div className="flex items-start gap-3">
        <AlumniAvatar user={profile.user} />
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-base font-semibold leading-snug text-foreground">
            <Link
              href={profileHref(profile.id)}
              className="rounded-sm after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none"
            >
              {name}
            </Link>
          </h3>
          {subtitle && <p className="mt-0.5 line-clamp-2 break-words text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>

      <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
        {showJob && (
          <li className="flex items-start gap-2">
            <Briefcase className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="sr-only">{t("job")}: </span>
            <span className="break-words">{job}</span>
          </li>
        )}
        {school && (
          <li className="flex items-start gap-2">
            <GraduationCap className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="sr-only">{t("school")}: </span>
            <span className="break-words">{school}</span>
          </li>
        )}
        {profile.city && (
          <li className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="sr-only">{t("city")}: </span>
            <span className="break-words">{profile.city}</span>
          </li>
        )}
      </ul>

      {profile.skills.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t("skills")}>
          {profile.skills.slice(0, VISIBLE_SKILLS).map((skill) => (
            <li
              key={skill}
              className={
                activeSkill && skill.toLowerCase() === activeSkill.toLowerCase()
                  ? "rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground"
                  : "rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
              }
            >
              {skill}
            </li>
          ))}
          {extraSkills > 0 && (
            <li className="rounded-full px-1.5 py-0.5 text-xs text-muted-foreground">{t("moreSkills", { count: extraSkills })}</li>
          )}
        </ul>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
        {profile.sector && (
          <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium text-foreground" data-sector={profile.sector}>
            {profile.sector}
          </span>
        )}
        {profile.mentoringAvailable && <MentoringBadge />}
      </div>
    </article>
  );
}
