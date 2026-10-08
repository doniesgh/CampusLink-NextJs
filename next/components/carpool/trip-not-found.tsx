import type { ReactNode } from "react";
import { ArrowLeft, MapPinOff } from "lucide-react";
import Link from "@/components/ui/app-link";
import { Button } from "@/components/ui/button";
import { carpoolHref } from "@/lib/carpool/paths";

/**
 * Full-page "not available" state of a trip page (unknown id, trip that can't be loaded): its title is the page's
 * h1. No hooks, so the server page and the client view both render it with their own translations.
 */
export function TripNotFound({
  title,
  description,
  backLabel,
  action,
}: {
  title: string;
  description?: string;
  backLabel: string;
  /** Extra action next to "Back to carpooling" (e.g. "Try again"). */
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-3xl border border-dashed bg-card px-6 py-12 text-center" data-testid="trip-not-found">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-primary">
        <MapPinOff className="h-6 w-6" aria-hidden="true" />
      </span>
      <h1 className="mt-4 font-heading text-xl font-semibold text-foreground">{title}</h1>
      {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {action}
        <Button asChild variant="outline" className="rounded-full">
          <Link href={carpoolHref}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {backLabel}
          </Link>
        </Button>
      </div>
    </div>
  );
}
