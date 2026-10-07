import { GraduationCap, Layers, UserRound, Users, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Audience } from "@/lib/announcements/types";

function Chip({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-sm text-foreground">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      {children}
    </li>
  );
}

/** Who receives an announcement: "Everyone", or role / program / level / group pills. */
export function AudienceSummary({ audience }: { audience: Audience }) {
  const t = useTranslations("announcements.audience");
  const tRoles = useTranslations("common.roles");
  const roles = audience?.roles ?? [];
  const programs = audience?.programs ?? [];
  const levels = audience?.levels ?? [];
  const groups = audience?.groups ?? [];

  if (roles.length + programs.length + levels.length + groups.length === 0) {
    return <p className="text-sm font-medium text-foreground">{t("everyone")}</p>;
  }

  return (
    <ul className="flex flex-wrap gap-2" aria-label={t("summaryLabel")}>
      {roles.map((role) => (
        <Chip key={`role-${role}`} icon={UserRound}>
          {tRoles(role)}
        </Chip>
      ))}
      {programs.map((program) => (
        <Chip key={`program-${program.id}`} icon={GraduationCap}>
          {program.code || program.name}
        </Chip>
      ))}
      {levels.map((level) => (
        <Chip key={`level-${level}`} icon={Layers}>
          {t("levelLabel", { level })}
        </Chip>
      ))}
      {groups.map((group) => (
        <Chip key={`group-${group.id}`} icon={Users}>
          {group.name}
        </Chip>
      ))}
    </ul>
  );
}
