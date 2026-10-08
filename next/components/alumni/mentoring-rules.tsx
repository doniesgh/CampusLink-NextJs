import { ListChecks } from "lucide-react";
import { useTranslations } from "next-intl";
import { MAX_PENDING_PER_STUDENT, MESSAGE_MAX_LENGTH, MESSAGE_MIN_LENGTH } from "@/lib/alumni/types";
import { cn } from "@/lib/utils";

const STEPS = ["find", "explain", "answer", "contact"] as const;

/** "How mentoring works": the four steps and the limits (3 pending requests, one per alumni), for students. */
export function MentoringRules({ className, headingLevel = "h3" }: { className?: string; headingLevel?: "h2" | "h3" }) {
  const t = useTranslations("alumni.rules");
  const Heading = headingLevel;
  return (
    <div className={cn("rounded-2xl border border-primary/20 bg-accent/60 p-4 text-sm text-accent-foreground", className)} data-testid="mentoring-rules">
      <Heading className="flex items-center gap-2 font-semibold">
        <ListChecks className="h-4 w-4" aria-hidden="true" />
        {t("title")}
      </Heading>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        {STEPS.map((step) => (
          <li key={step}>{t(`steps.${step}`, { min: MESSAGE_MIN_LENGTH, max: MESSAGE_MAX_LENGTH })}</li>
        ))}
      </ol>
      <p className="mt-2 font-medium">{t("limits", { max: MAX_PENDING_PER_STUDENT })}</p>
    </div>
  );
}
