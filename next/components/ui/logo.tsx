import Link from "@/components/ui/app-link";
import { GraduationCap } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export default function Logo({ href = "/", className }: { href?: string; className?: string }) {
  const t = useTranslations("common.logo");
  return (
    <Link href={href} className={cn("mr-4 flex items-center gap-2.5 rounded-xl", className)} aria-label={t("home")}>
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/30">
        <GraduationCap className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="font-heading text-lg font-bold tracking-tight text-foreground">CampusLink</span>
    </Link>
  );
}
