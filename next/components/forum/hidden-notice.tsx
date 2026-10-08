import { EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * Notice on hidden content, which only ADMINs and its author receive: "Hidden by the moderation team",
 * who can still see it, and the reason given to the author (plain text).
 */
export function HiddenNotice({ reason, viewerIsAdmin, className }: { reason?: string | null; viewerIsAdmin: boolean; className?: string }) {
  const t = useTranslations("forum.hidden");
  return (
    <div
      className={cn("flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive", className)}
      data-testid="hidden-notice"
    >
      <EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-semibold">{t("title")}</p>
        <p>{t(viewerIsAdmin ? "adminText" : "authorText")}</p>
        {reason && <p className="whitespace-pre-wrap break-words">{t("reason", { reason })}</p>}
      </div>
    </div>
  );
}
