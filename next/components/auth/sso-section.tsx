import { School } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** School single sign-on is planned but not implemented yet: a disabled button with a "Soon" pill, then the "or with email" divider. */
export function SsoSection({ className }: { className?: string }) {
  const t = useTranslations("auth.sso");
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled
        aria-describedby="sso-soon"
        className={cn("h-11 w-full rounded-xl text-primary", className)}
      >
        <School className="h-4 w-4" aria-hidden="true" />
        {t("button")}
        <span className="ml-1 rounded-full bg-highlight px-2 py-0.5 text-xs font-semibold text-highlight-foreground">
          {t("soon")}
        </span>
      </Button>
      <span id="sso-soon" className="sr-only">
        {t("soonDescription")}
      </span>
      <div className="my-6 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        {t("divider")}
        <span className="h-px flex-1 bg-border" />
      </div>
    </>
  );
}
